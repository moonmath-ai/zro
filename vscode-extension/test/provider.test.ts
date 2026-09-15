import { describe, it, expect, beforeEach } from "vitest";
import { toChatInfo, buildRequestBody, toOpenAiMessages, applyReasoningEffort } from "../src/provider.js";
import {
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
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

interface ZroModelInput {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
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