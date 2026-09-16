import { describe, it, expect, beforeEach } from "vitest";
import {
  toChatInfo,
  toChatInfos,
  buildRequestBody,
  buildEntryRequestBody,
  resolveEntry,
  toOpenAiMessages,
  applyReasoningEffort,
  streamChatResponse
} from "../src/provider.js";
import {
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
  __setConfig,
  __resetConfig
} from "./mocks/vscode.js";
import { CONFIG_SECTION, SETTING_REASONING_EFFORT, type ZroReasoningConfig } from "../src/constants.js";
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

  it("attaches a thinking-effort configuration schema for reasoning models", () => {
    const info = toChatInfo(REASONING_MODEL);
    expect(info.configurationSchema?.properties.reasoningEffort).toEqual({
      type: "string",
      title: "Thinking Effort",
      enum: ["none", "high", "max"],
      enumDescriptions: ["off", "mid", "top"],
      default: "max",
      group: "navigation"
    });
  });

  it("omits the configuration schema for models without reasoning", () => {
    expect(toChatInfo(DEFAULT_MODEL).configurationSchema).toBeUndefined();
  });
});

describe("toChatInfos", () => {
  it("lists one entry per non-default level, plus the model's own row", () => {
    const infos = toChatInfos(REASONING_MODEL);
    expect(infos.map((i) => i.id)).toEqual([
      "glm-5.2",
      "glm-5.2--none",
      "glm-5.2--high"
    ]);
    expect(infos.map((i) => i.name)).toEqual([
      "ZRO GLM-5.2",
      "ZRO GLM-5.2 · No thinking",
      "ZRO GLM-5.2 · High"
    ]);
  });

  it("leaves non-reasoning models as a single entry", () => {
    expect(toChatInfos(DEFAULT_MODEL).map((i) => i.id)).toEqual(["glm-5.2"]);
  });

  it("keeps every entry in the same family with the same limits", () => {
    const infos = toChatInfos(REASONING_MODEL);
    for (const info of infos) {
      expect(info.family).toBe("zro-glm-5.2");
      expect(info.maxOutputTokens).toBe(64_000);
      expect(info.maxInputTokens).toBe(524_288 - 64_000);
    }
  });

  it("keeps the configuration dropdown on the model row only", () => {
    const infos = toChatInfos(REASONING_MODEL);
    expect(infos[0].configurationSchema?.properties.reasoningEffort).toBeDefined();
    for (const variant of infos.slice(1)) {
      expect(variant.configurationSchema).toBeUndefined();
    }
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
});

describe("resolveEntry", () => {
  it("resolves a level entry to the catalog model plus its level", () => {
    expect(resolveEntry(REASONING_MODEL, "glm-5.2--high")).toEqual({
      modelId: "glm-5.2",
      reasoning: REASONING_MODEL.reasoning,
      effort: "high"
    });
  });

  it("leaves the model's own entry without a fixed level", () => {
    const entry = resolveEntry(REASONING_MODEL, "glm-5.2");
    expect(entry.modelId).toBe("glm-5.2");
    expect(entry.effort).toBeUndefined();
  });

  it("ignores a level the model does not advertise", () => {
    expect(resolveEntry(REASONING_MODEL, "glm-5.2--xhigh").effort).toBeUndefined();
    expect(resolveEntry(DEFAULT_MODEL, "glm-5.2--high").effort).toBeUndefined();
  });
});

describe("buildEntryRequestBody", () => {
  const entryModel: ZroModelInput = {
    ...REASONING_MODEL,
    reasoning: {
      defaultLevel: "high",
      levels: [
        { id: "none", description: "off" },
        { id: "high", description: "mid" },
        { id: "max", description: "top" }
      ]
    }
  };

  beforeEach(() => {
    __resetConfig();
  });

  it("sends the catalog model id and the entry's level", () => {
    const info = toChatInfos(entryModel);
    const maxInfo = info.find((i) => i.id === "glm-5.2--max")!;
    const body = buildEntryRequestBody(maxInfo, [], {}, resolveEntry(entryModel, maxInfo.id));
    expect(body.model).toBe("glm-5.2");
    expect(body.reasoning_effort).toBe("max");
  });

  it("sends nothing for the model's default entry when no setting applies", () => {
    const info = toChatInfos(entryModel)[0]; // glm-5.2 (default level)
    const body = buildEntryRequestBody(info, [], {}, resolveEntry(entryModel, info.id));
    expect(body.model).toBe("glm-5.2");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("lets a level entry beat the global setting", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "none" });
    const info = toChatInfos(entryModel);
    const maxInfo = info.find((i) => i.id === "glm-5.2--max")!;
    const body = buildEntryRequestBody(maxInfo, [], {}, resolveEntry(entryModel, maxInfo.id));
    expect(body.reasoning_effort).toBe("max");
  });

  it("honors the in-picker config choice for the model's own entry", () => {
    const info = toChatInfos(entryModel)[0];
    const body = buildEntryRequestBody(
      info,
      [],
      { modelConfiguration: { reasoningEffort: "max" } } as never,
      resolveEntry(entryModel, info.id)
    );
    expect(body.reasoning_effort).toBe("max");
  });

  it("leaves non-reasoning models untouched", () => {
    const info = toChatInfos(DEFAULT_MODEL)[0];
    const body = buildEntryRequestBody(info, [], {}, resolveEntry(DEFAULT_MODEL, info.id));
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