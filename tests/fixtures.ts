import type { ZroModel, ZroModalities, ZroReasoningConfig } from "../src/engine/constants.js";

export function testModel(
  id: string,
  modalities: ZroModalities,
  reasoning?: ZroReasoningConfig,
): ZroModel {
  return {
    id,
    displayName: id,
    contextWindow: 200_000,
    maxOutputTokens: 20_000,
    modalities,
    reasoning: reasoning ?? {
      defaultLevel: "high",
      levels: [
        {
          id: "low",
          description: "Use low reasoning effort",
          piLevel: "low",
          openCodeOptions: { reasoningEffort: "low" },
        },
        {
          id: "high",
          description: "Use high reasoning effort",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" },
        },
        {
          id: "max",
          description: "Use maximum reasoning effort",
          codexEffort: "xhigh",
          piLevel: "xhigh",
          openCodeOptions: { reasoningEffort: "max" },
        },
      ],
    },
  };
}

const GLM_REASONING: ZroReasoningConfig = {
  defaultLevel: "max",
  levels: [
    {
      id: "none",
      description: "Disable reasoning for the lowest latency",
      codexEffort: "disabled",
      piLevel: "off",
      openCodeOptions: { reasoningEffort: "none" },
    },
    {
      id: "high",
      description: "Use high reasoning effort",
      piLevel: "high",
      openCodeOptions: { reasoningEffort: "high" },
    },
    {
      id: "max",
      description: "Use maximum reasoning effort",
      piLevel: "xhigh",
      openCodeOptions: { reasoningEffort: "max" },
    },
  ],
};

export const TEST_MODELS: readonly ZroModel[] = [
  testModel("glm-5.3", { input: ["text"], output: ["text"] }, GLM_REASONING),
  testModel("kimi-k3", { input: ["text", "image"], output: ["text"] }),
];

const TEXT = { input: ["text"], output: ["text"] } as ZroModalities;
const VISION = { input: ["text", "image"], output: ["text"] } as ZroModalities;

function sized(
  id: string,
  displayName: string,
  maxOutputTokens: number,
  modalities: ZroModalities,
  reasoning?: ZroReasoningConfig,
): ZroModel {
  return { ...testModel(id, modalities, reasoning), displayName, contextWindow: 1_048_576, maxOutputTokens };
}

const AUTO_REASONING: ZroReasoningConfig = {
  defaultLevel: "auto",
  levels: [
    {
      id: "auto",
      description: "Let the router pick the model per request",
      codexEffort: "medium",
      piLevel: "medium",
      openCodeOptions: {},
    },
  ],
};

// 1M-window models whose differing output caps drive Claude tier-slot assignment.
export const TIER_MODELS: readonly ZroModel[] = [
  sized("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", 384_000, VISION),
  sized("glm-5.3", "GLM-5.3", 131_000, TEXT, GLM_REASONING),
  sized("glm-5.3-flash", "GLM-5.3 Flash", 64_000, VISION, GLM_REASONING),
  sized("dolly1-security", "Dolly 1 Security", 64_000, VISION, GLM_REASONING),
  sized("auto", "Auto", 131_000, TEXT, AUTO_REASONING),
  sized("kimi-k3", "Kimi K3", 1_048_576, VISION),
];

export const TEST_CATALOG_RESPONSE = { version: 1, default: "glm-5.3", models: TEST_MODELS };

export function catalogFetch(otherStatus = 200) {
  return async (input: string | URL | Request): Promise<Response> =>
    String(input).endsWith("/api/cli/models")
      ? Response.json(TEST_CATALOG_RESPONSE)
      : new Response(null, { status: otherStatus });
}
