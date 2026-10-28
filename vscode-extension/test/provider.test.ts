import { describe, it, expect, beforeEach } from "vitest";
import {
  toChatInfo,
  buildRequestBody,
  toOpenAiMessages,
  applyReasoningEffort,
  streamChatResponse
} from "../src/provider.js";
import {
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelTextPart,
  LanguageModelThinkingPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
  __setConfig,
  __resetConfig
} from "./mocks/vscode.js";
import { CONFIG_SECTION, SETTING_REASONING_EFFORT, type ZroModelPricing, type ZroReasoningConfig } from "../src/constants.js";
import { effortFromModelConfiguration } from "../src/reasoning.js";
import type { LanguageModelChatInformation, LanguageModelChatRequestMessage } from "vscode";

const DEFAULT_MODEL: ZroModelInput = {
  id: "glm-5.2",
  displayName: "GLM-5.2",
  contextWindow: 524288,
  maxOutputTokens: 64000
};

const REASONING_MODEL: ZroModelInput = {
  ...DEFAULT_MODEL,
  reasoning: {
    defaultLevel: "max",
    levels: [
      { id: "none", description: "off" },
      { id: "high", description: "mid" },
      { id: "max", description: "top" }
    ]
  }
};

interface ZroModelInput {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning?: ZroReasoningConfig;
  pricing?: ZroModelPricing;
  imageInput?: boolean;
}

function chatInfo(id = DEFAULT_MODEL.id, maxOutputTokens = DEFAULT_MODEL.maxOutputTokens): LanguageModelChatInformation {
  return {
    id,
    name: `ZRO ${id}`,
    family: `zro-${id}`,
    version: "1.0.0",
    maxInputTokens: 1000,
    maxOutputTokens,
    capabilities: { toolCalling: true, imageInput: false }
  };
}

function makeMessage(
  role: LanguageModelChatMessageRole,
  content: LanguageModelChatRequestMessage["content"]
): LanguageModelChatRequestMessage {
  return { role, content };
}

describe("toChatInfo", () => {
  it("gives each model a distinct family", () => {
    const info = toChatInfo(DEFAULT_MODEL);
    expect(info.family).toBe("zro-glm-5.2");
    expect(info.id).toBe("glm-5.2");
  });

  it("caps max output tokens at half the context window", () => {
    const model: ZroModelInput = { id: "kimi-k3", displayName: "Kimi K3", contextWindow: 1_048_576, maxOutputTokens: 1_048_576 };
    const info = toChatInfo(model);
    expect(info.maxOutputTokens).toBe(1_048_576 / 2);
    expect(info.maxInputTokens).toBe(1_048_576 / 2);
  });

  it("keeps output within the advertised max", () => {
    const info = toChatInfo(DEFAULT_MODEL);
    expect(info.maxOutputTokens).toBe(64_000);
    expect(info.maxInputTokens).toBe(524_288 - 64_000);
  });

  it("advertises tool calling and no image input", () => {
    const info = toChatInfo(DEFAULT_MODEL);
    expect(info.capabilities).toEqual({ toolCalling: true, imageInput: false });
  });

  it("advertises image input only for vision models", () => {
    const vision = toChatInfo({ ...DEFAULT_MODEL, imageInput: true });
    expect(vision.capabilities?.imageInput).toBe(true);
    expect(toChatInfo(DEFAULT_MODEL).capabilities?.imageInput).toBe(false);
  });

  it("attaches the thinking-effort dropdown schema for reasoning models", () => {
    const info = toChatInfo(REASONING_MODEL);
    expect(info.configurationSchema?.properties.reasoningEffort).toEqual({
      type: "string",
      title: "Thinking Effort",
      enum: ["none", "high", "max"],
      enumItemLabels: ["No thinking", "High", "Max"],
      enumDescriptions: ["off", "mid", "top"],
      default: "max",
      group: "navigation"
    });
  });

  it("omits the configuration schema for models without reasoning", () => {
    expect(toChatInfo(DEFAULT_MODEL).configurationSchema).toBeUndefined();
  });

  it("attaches cost metadata for a priced model", () => {
    // DeepSeek V4.1 Flash's published (promotional) rates.
    const info = toChatInfo({
      ...DEFAULT_MODEL,
      pricing: { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.003 }
    });
    expect(info.pricing).toBe("$0.15 in · $0.60 out per 1M tokens");
    // The gate core checks before rendering any price.
    expect(info.multiplierNumeric).toBe(1);
    expect(info.priceCategory).toBe("low");
  });

  it("adds no cost fields for an unpriced model", () => {
    const info = toChatInfo(DEFAULT_MODEL);
    expect(info.pricing).toBeUndefined();
    expect(info.multiplierNumeric).toBeUndefined();
    expect(info.priceCategory).toBeUndefined();
    // Absent rather than explicitly undefined, so nothing is advertised at all.
    expect(Object.keys(info)).not.toContain("multiplierNumeric");
  });
});

describe("buildRequestBody", () => {
  it("builds a streaming chat body with the model id", () => {
    const body = buildRequestBody(chatInfo(), [], {});
    expect(body.model).toBe("glm-5.2");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(64_000);
    expect(body.messages).toEqual([]);
  });

  it("attaches tools when options include them", () => {
    const body = buildRequestBody(chatInfo(), [], {
      tools: [
        { name: "read", description: "Read a file", inputSchema: { type: "object", properties: {} } }
      ],
      toolMode: LanguageModelChatToolMode.Required
    });
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } }
      }
    ]);
    expect(body.tool_choice).toBe("required");
  });

  it("merges modelOptions that do not collide with the body", () => {
    const body = buildRequestBody(chatInfo(), [], { modelOptions: { temperature: 0.2, stream: false } });
    expect(body.temperature).toBe(0.2);
    // Existing keys win over modelOptions.
    expect(body.stream).toBe(true);
  });

  it("converts a text-only user message", () => {
    const msg = makeMessage(LanguageModelChatMessageRole.User, [new LanguageModelTextPart("hi")]);
    const body = buildRequestBody(chatInfo(), [msg], {});
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("requests the trailing usage chunk", () => {
    const body = buildRequestBody(chatInfo(), [], {});
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

describe("streamChatResponse usage reporting", () => {
  /** SSE response body from a list of already-serialised chunk payloads. */
  function sseResponse(payloads: string[]): Response {
    const text = payloads.map((p) => `data: ${p}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        }
      })
    );
  }

  function delta(content: string): string {
    return JSON.stringify({ choices: [{ index: 0, delta: { content } }] });
  }

  /** The final chunk ZRO sends: a placeholder choice plus the usage block. */
  function usageChunk(usage: Record<string, unknown>): string {
    return JSON.stringify({ choices: [{ index: 0, delta: {} }], usage });
  }

  /** Captured from a live deepseek-v4-flash-0731 response (capture-log.jsonl). */
  const REAL_USAGE = {
    completion_tokens: 18, prompt_tokens: 28136, total_tokens: 28154,
    completion_tokens_details: { reasoning_tokens: 12 } };

  function collect() {
    const parts: Array<unknown> = [];
    return {
      parts,
      progress: { report: (part: unknown) => parts.push(part) } as never
    };
  }

  async function run(payloads: string[]) {
    const { parts, progress } = collect();
    await streamChatResponse(sseResponse(payloads), progress, { onCancellationRequested: () => ({ dispose() {} }) } as never);
    return parts;
  }

  it("reports a usage data part after the streamed text", async () => {
    const parts = await run([delta("Hello"), usageChunk(REAL_USAGE)]);
    const usagePart = parts.at(-1) as LanguageModelDataPart;
    expect(usagePart.mimeType).toBe("usage");
    expect(JSON.parse(new TextDecoder().decode(usagePart.data))).toEqual({
      prompt_tokens: 28136,
      completion_tokens: 18,
      total_tokens: 28154
    });
    // Content still arrives, and before the usage part.
    expect(parts[0]).toBeInstanceOf(LanguageModelTextPart);
  });

  it("maps ZRO cache reads to prompt_tokens_details.cached_tokens", async () => {
    const parts = await run([delta("hi"), usageChunk({ ...REAL_USAGE, cache_read_input_tokens: 26061 })]);
    const usagePart = parts.at(-1) as LanguageModelDataPart;
    expect(JSON.parse(new TextDecoder().decode(usagePart.data))).toMatchObject({
      prompt_tokens_details: { cached_tokens: 26061 }
    });
  });

  it("omits the cache detail when nothing was cached", async () => {
    const parts = await run([delta("hi"), usageChunk({ ...REAL_USAGE, cache_read_input_tokens: 0 })]);
    const payload = JSON.parse(new TextDecoder().decode((parts.at(-1) as LanguageModelDataPart).data));
    expect(payload).not.toHaveProperty("prompt_tokens_details");
  });

  it("captures usage from a chunk with an empty choices array", async () => {
    const parts = await run([delta("hi"), JSON.stringify({ choices: [], usage: REAL_USAGE })]);
    expect((parts.at(-1) as LanguageModelDataPart).mimeType).toBe("usage");
  });

  it("derives total_tokens when the endpoint omits it", async () => {
    const parts = await run([usageChunk({ prompt_tokens: 10, completion_tokens: 5 })]);
    const payload = JSON.parse(new TextDecoder().decode((parts.at(-1) as LanguageModelDataPart).data));
    expect(payload.total_tokens).toBe(15);
  });

  it("reports no usage part when the stream never sends one", async () => {
    const parts = await run([delta("Hello")]);
    expect(parts.some((p) => p instanceof LanguageModelDataPart)).toBe(false);
    expect(parts).toHaveLength(1);
  });

  function reasoningChunk(reasoning: string): string {
    return JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] });
  }

  it("reports reasoning deltas as thinking parts", async () => {
    const parts = await run([reasoningChunk("pondering"), delta("Answer")]);
    expect(parts[0]).toBeInstanceOf(LanguageModelThinkingPart);
    expect((parts[0] as { value: string }).value).toBe("pondering");
    // The visible answer still arrives as a plain text part.
    expect(parts[1]).toBeInstanceOf(LanguageModelTextPart);
  });

  it("falls back to a text part when the runtime lacks thinking parts", async () => {
    const vscodeMock = await import("./mocks/vscode.js");
    const Thinking = vscodeMock.LanguageModelThinkingPart;
    // Simulate an older extension host without the class.
    // @ts-expect-error - deliberately breaking the mock's shape
    delete vscodeMock.LanguageModelThinkingPart;
    try {
      const parts = await run([reasoningChunk("pondering")]);
      expect(parts[0]).toBeInstanceOf(LanguageModelTextPart);
      expect(parts).toHaveLength(1);
    } finally {
      // Restore for subsequent tests.
      (vscodeMock as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart = Thinking;
    }
  });
});

/**
 * The row's "Thinking Effort" dropdown reaches the provider as
 * `options.modelConfiguration`. This mirrors the response path: build the body,
 * read the dropdown choice, apply it.
 */
describe("reasoning effort from the row dropdown", () => {
  const REASONING = REASONING_MODEL.reasoning!;

  function bodyFor(options: Record<string, unknown>): Record<string, unknown> {
    const body = buildRequestBody(chatInfo(), [], options);
    const chosen = effortFromModelConfiguration(options.modelConfiguration, REASONING);
    applyReasoningEffort(body, REASONING, chosen);
    return body;
  }

  beforeEach(() => {
    __resetConfig();
  });

  it("sends the level chosen in the dropdown", () => {
    const body = bodyFor({ modelConfiguration: { reasoningEffort: "high" } });
    expect(body.model).toBe("glm-5.2");
    expect(body.reasoning_effort).toBe("high");
  });

  it("sends nothing when the dropdown is untouched", () => {
    const body = bodyFor({});
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("lets the dropdown choice beat the global setting", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "none" });
    expect(bodyFor({ modelConfiguration: { reasoningEffort: "max" } }).reasoning_effort).toBe("max");
  });

  it("ignores a level the model does not advertise", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "none" });
    expect(bodyFor({ modelConfiguration: { reasoningEffort: "xhigh" } }).reasoning_effort).toBe("none");
  });

  it("falls back to the global setting when the dropdown is untouched", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "none" });
    expect(bodyFor({}).reasoning_effort).toBe("none");
  });

  it("leaves non-reasoning models untouched", () => {
    const body = buildRequestBody(chatInfo(), [], { modelConfiguration: { reasoningEffort: "high" } });
    applyReasoningEffort(body, undefined, effortFromModelConfiguration({ reasoningEffort: "high" }, undefined));
    expect(body.model).toBe("glm-5.2");
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});

describe("applyReasoningEffort", () => {
  const REASONING: ZroReasoningConfig = {
    defaultLevel: "max",
    levels: [
      { id: "none", description: "off" },
      { id: "max", description: "top" }
    ]
  };

  beforeEach(() => {
    __resetConfig();
  });

  it("omits reasoning_effort when nothing is configured", () => {
    const body = buildRequestBody(chatInfo(), [], {});
    applyReasoningEffort(body, REASONING);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("sends the configured global level", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "none" });
    const body = buildRequestBody(chatInfo(), [], {});
    applyReasoningEffort(body, REASONING);
    expect(body.reasoning_effort).toBe("none");
  });

  it("does nothing for a model with no reasoning levels", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "max" });
    const body = buildRequestBody(chatInfo(), [], {});
    applyReasoningEffort(body, undefined);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("does not overwrite a caller-supplied reasoning_effort", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "none" });
    const body = buildRequestBody(chatInfo(), [], { modelOptions: { reasoning_effort: "high" } });
    applyReasoningEffort(body, REASONING);
    expect(body.reasoning_effort).toBe("high");
  });

  it("sends the in-picker effort when provided", () => {
    const body = buildRequestBody(chatInfo(), [], {});
    applyReasoningEffort(body, REASONING, "none");
    expect(body.reasoning_effort).toBe("none");
  });

  it("prefers the in-picker effort over extension settings", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "max" });
    const body = buildRequestBody(chatInfo(), [], {});
    applyReasoningEffort(body, REASONING, "none");
    expect(body.reasoning_effort).toBe("none");
  });

  it("lets a caller-supplied reasoning_effort beat the in-picker effort", () => {
    const body = buildRequestBody(chatInfo(), [], { modelOptions: { reasoning_effort: "high" } });
    applyReasoningEffort(body, REASONING, "max");
    expect(body.reasoning_effort).toBe("high");
  });

  it("falls back to extension settings when no picker effort is given", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "none" });
    const body = buildRequestBody(chatInfo(), [], {});
    applyReasoningEffort(body, REASONING, null);
    expect(body.reasoning_effort).toBe("none");
  });
});

describe("toOpenAiMessages", () => {
  it("maps assistant messages to the assistant role", () => {
    const msg = makeMessage(LanguageModelChatMessageRole.Assistant, [new LanguageModelTextPart("ok")]);
    expect(toOpenAiMessages(msg)).toEqual([{ role: "assistant", content: "ok" }]);
  });

  it("converts tool calls into assistant tool_calls", () => {
    const msg = makeMessage(LanguageModelChatMessageRole.Assistant, [
      new LanguageModelToolCallPart("call_1", "readFile", { path: "a.ts" })
    ]);
    const out = toOpenAiMessages(msg);
    expect(out).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "readFile", arguments: JSON.stringify({ path: "a.ts" }) }
          }
        ]
      }
    ]);
  });

  it("emits tool results as role:tool messages", () => {
    const msg = makeMessage(LanguageModelChatMessageRole.Assistant, [
      new LanguageModelToolResultPart("call_1", ["file contents"])
    ]);
    expect(toOpenAiMessages(msg)).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "file contents" }
    ]);
  });
});