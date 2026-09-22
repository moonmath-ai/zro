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

const DEEPSEEK_REASONING: ZroReasoningConfig = {
  defaultLevel: "high",
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
  ],
};

export const TEST_MODELS: readonly ZroModel[] = [
  testModel("glm-5.2", { input: ["text"], output: ["text"] }, GLM_REASONING),
  testModel("kimi-k3", { input: ["text", "image"], output: ["text"] }),
  testModel("deepseek-v4-flash-0731", { input: ["text"], output: ["text"] }, DEEPSEEK_REASONING),
];

export const TEST_CATALOG = {
  version: 1 as const,
  default: "glm-5.2",
  models: TEST_MODELS,
};