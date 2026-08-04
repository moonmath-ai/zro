import * as vscode from "vscode";
import { BASE_URL, PROVIDER_NAME, type ZroModel } from "./constants.js";
import { fetchModelCatalog } from "./catalog.js";
import { resolveApiKey } from "./credentials.js";

/**
 * Registers ZRO models with VS Code's Copilot Chat model picker and
 * streams chat completions from the Zro inference endpoint (OpenAI-compatible
 * /v1). The model list is discovered dynamically from the control plane.
 */
export class ZroModelProvider implements vscode.LanguageModelChatProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    let apiKey = await resolveApiKey(this.context);
    if (!apiKey) {
      // When silent (e.g. VS Code pre-populating the picker), don't prompt.
      if (!options.silent) {
        await vscode.commands.executeCommand("zro.manage");
      }
      // If a key was just entered, models will appear on the next refresh.
      apiKey = await resolveApiKey(this.context);
      if (!apiKey) return [];
    }

    const { models } = await fetchModelCatalog(apiKey);
    return models.map((model) => toChatInfo(model));
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = await resolveApiKey(this.context);
    if (!apiKey) {
      progress.report(new vscode.LanguageModelTextPart("[ZRO: no API key. Run the 'ZRO: Enter API key' command or `zro login`.]"));
      return;
    }

    const body = buildRequestBody(model, messages, options);
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      progress.report(
        new vscode.LanguageModelTextPart(`[ZRO error ${response.status}: ${detail || response.statusText}]`)
      );
      return;
    }

    await streamChatResponse(response, progress, token);
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    // Rough character-based estimate (~4 chars/token). Good enough for the
    // context-window indicator; a real tokenizer isn't available here.
    if (typeof text === "string") {
      return Math.ceil(text.length / 4);
    }
    const len = text.content.reduce<number>((sum, part) => {
      if (part instanceof vscode.LanguageModelTextPart) return sum + part.value.length;
      return sum + JSON.stringify(part).length;
    }, 0);
    return Math.ceil(len / 4);
  }
}

function toChatInfo(model: ZroModel): vscode.LanguageModelChatInformation {
  // A misconfigured catalog can advertise maxOutputTokens >= contextWindow
  // (kimi-k3 shipped with maxOutputTokens = contextWindow = 1_048_576). Copilot
  // forwards that verbatim as max_tokens, and the model rejects the request
  // because input + completion > context. Cap maxOutputTokens at half the
  // context window so input always has room; the true per-model cap (64k for
  // kimi, 384k for deepseek, …) is what the catalog should be serving.
  const cappedMaxOutput = Math.min(
    model.maxOutputTokens,
    Math.floor(model.contextWindow / 2)
  );
  return {
    id: model.id,
    name: `${PROVIDER_NAME} ${model.displayName}`,
    family: "zro",
    tooltip: `${PROVIDER_NAME} model via ${BASE_URL}`,
    version: "1.0.0",
    maxInputTokens: model.contextWindow - cappedMaxOutput,
    maxOutputTokens: cappedMaxOutput,
    capabilities: {
      toolCalling: true,
      imageInput: false
    }
  };
}

// --- Request building --------------------------------------------------------

interface OpenAiMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function buildRequestBody(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions
): Record<string, unknown> {
  const openaiMessages = messages.flatMap(toOpenAiMessages);
  const body: Record<string, unknown> = {
    model: model.id,
    messages: openaiMessages,
    stream: true,
    max_tokens: model.maxOutputTokens
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: "object", properties: {} }
      }
    }));
    body.tool_choice = options.toolMode === vscode.LanguageModelChatToolMode.Required
      ? "required"
      : "auto";
  }

  if (options.modelOptions) {
    for (const [key, value] of Object.entries(options.modelOptions)) {
      if (!(key in body)) body[key] = value;
    }
  }

  return body;
}

/**
 * Convert a VS Code request message into one or more OpenAI messages.
 * A VS Code assistant message carrying tool-call parts becomes an OpenAI
 * assistant message with `tool_calls`; a user message carrying tool-result
 * parts becomes one OpenAI `role: "tool"` message per result.
 */
function toOpenAiMessages(msg: vscode.LanguageModelChatRequestMessage): OpenAiMessage[] {
  const textParts: string[] = [];
  const toolCalls: NonNullable<OpenAiMessage["tool_calls"]> = [];
  const toolResults: Array<{ callId: string; content: string }> = [];

  for (const part of msg.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      textParts.push(part.value);
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: part.callId,
        type: "function",
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input ?? {})
        }
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      const content = part.content
        .map((item) =>
          item instanceof vscode.LanguageModelTextPart
            ? item.value
            : typeof item === "string"
              ? item
              : JSON.stringify(item)
        )
        .join("\n");
      toolResults.push({ callId: part.callId, content });
    }
  }

  const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant
    ? "assistant"
    : msg.role === vscode.LanguageModelChatMessageRole.User
      ? "user"
      : "system";

  const result: OpenAiMessage[] = [];

  // Tool results become individual role:tool messages.
  for (const tr of toolResults) {
    result.push({ role: "tool", tool_call_id: tr.callId, content: tr.content });
  }

  // If there were tool calls or text, emit the message itself.
  if (toolCalls.length > 0 || textParts.length > 0 || toolResults.length === 0) {
    const message: OpenAiMessage = { role };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    message.content = textParts.join("\n") || null;
    result.push(message);
  }

  return result;
}

// --- SSE streaming ------------------------------------------------------------

interface ToolCallBuffer {
  id: string;
  name: string;
  arguments: string;
}

async function streamChatResponse(
  response: Response,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, ToolCallBuffer>();
  // Kimi-K3 (and some other reasoning models) stream their whole reply in
  // `delta.reasoning_content` with `content` left empty. Track whether we've
  // seen real content so we fall back to reporting reasoning only when the
  // model never emits any — otherwise we'd double-show the same text on models
  // that produce both fields.
  let hasContent = false;

  const cancellation = token.onCancellationRequested(() => reader.cancel().catch(() => {}));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          flushToolCalls(toolCalls, progress);
          return;
        }

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
          };

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          const { content, reasoning_content } = delta ?? {};
          if (content) {
            hasContent = true;
            progress.report(new vscode.LanguageModelTextPart(content));
          } else if (reasoning_content && !hasContent) {
            // Reasoning models like Kimi-K3 stream their whole reply in
            // `reasoning_content` with `content` left empty; otherwise they'd
            // render nothing in the chat. Only show the reasoning until real
            // content begins, so models that emit both don't double-print.
            progress.report(new vscode.LanguageModelTextPart(reasoning_content));
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.get(tc.index);
              if (!existing) {
                toolCalls.set(tc.index, {
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  arguments: tc.function?.arguments ?? ""
                });
              } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              }
            }
          }

          if (choice.finish_reason === "tool_calls") {
            flushToolCalls(toolCalls, progress);
          }
        } catch {
          // Skip malformed SSE lines — partial JSON is expected mid-stream.
        }
      }
    }

    // Stream ended without [DONE]; flush any pending tool calls.
    flushToolCalls(toolCalls, progress);
  } finally {
    cancellation.dispose();
  }
}

function flushToolCalls(
  toolCalls: Map<number, ToolCallBuffer>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>
): void {
  if (toolCalls.size === 0) return;
  const entries = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]);
  toolCalls.clear();
  for (const [, tc] of entries) {
    let input: object;
    try {
      input = JSON.parse(tc.arguments || "{}");
    } catch {
      input = { raw: tc.arguments };
    }
    progress.report(new vscode.LanguageModelToolCallPart(tc.id || tc.name, tc.name, input));
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}
