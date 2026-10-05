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
  testModel("glm-5.3", { input: ["text"], output: ["text"] }, GLM_REASONING),
  testModel("kimi-k3", { input: ["text", "image"], output: ["text"] }),
  testModel("deepseek-v4-flash-0731", { input: ["text"], output: ["text"] }, DEEPSEEK_REASONING),
];

export const TEST_CATALOG = {
  version: 1 as const,
  default: "glm-5.3",
  models: TEST_MODELS,
};
// Lineup used by Claude alias/allowlist tests that need a fixed six-model catalog.
export const ZRO_MODELS = [
  {
    id: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    contextWindow: 1048576,
    maxOutputTokens: 384000,
    modalities: { input: ["text", "image"], output: ["text"] },
    reasoning: {
      defaultLevel: "high",
      levels: [
        {
          id: "low",
          description: "Use DeepSeek low reasoning effort",
          piLevel: "low",
          openCodeOptions: { reasoningEffort: "low" }
        },
        {
          id: "high",
          description: "Use DeepSeek high reasoning effort",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" }
        },
        {
          id: "max",
          description: "Use DeepSeek maximum reasoning effort",
          codexEffort: "xhigh",
          piLevel: "xhigh",
          openCodeOptions: { reasoningEffort: "max" }
        }
      ]
    }
  },
  {
    id: "glm-5.3",
    displayName: "GLM-5.3",
    contextWindow: 1048576,
    maxOutputTokens: 131000,
    modalities: { input: ["text"], output: ["text"] },
    reasoning: {
      defaultLevel: "max",
      levels: [
        {
          id: "none",
          description: "Disable reasoning for the lowest latency",
          // Codex treats `none` as its unset/default sentinel and omits it
          // from the Responses request. A custom token survives the wire;
          // the proxy maps `disabled` back to GLM's native `none`.
          codexEffort: "disabled",
          piLevel: "off",
          openCodeOptions: { reasoningEffort: "none" }
        },
        {
          id: "high",
          description: "Use GLM High reasoning effort",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" }
        },
        {
          id: "max",
          description: "Use GLM maximum reasoning effort",
          codexEffort: "xhigh",
          piLevel: "xhigh",
          openCodeOptions: { reasoningEffort: "max" }
        }
      ]
    }
  },
  {
    id: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    contextWindow: 1048576,
    maxOutputTokens: 64000,
    modalities: { input: ["text", "image"], output: ["text"] },
    reasoning: {
      defaultLevel: "max",
      levels: [
        {
          id: "none",
          description: "Disable reasoning for the lowest latency",
          codexEffort: "disabled",
          piLevel: "off",
          openCodeOptions: { reasoningEffort: "none" }
        },
        {
          id: "high",
          description: "Use GLM High reasoning effort",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" }
        },
        {
          id: "max",
          description: "Use GLM maximum reasoning effort",
          codexEffort: "xhigh",
          piLevel: "xhigh",
          openCodeOptions: { reasoningEffort: "max" }
        }
      ]
    }
  },
  {
    id: "dolly1-security",
    displayName: "Dolly 1 Security",
    contextWindow: 1048576,
    maxOutputTokens: 64000,
    modalities: { input: ["text", "image"], output: ["text"] },
    reasoning: {
      defaultLevel: "max",
      levels: [
        {
          id: "none",
          description: "Disable reasoning for the lowest latency",
          codexEffort: "disabled",
          piLevel: "off",
          openCodeOptions: { reasoningEffort: "none" }
        },
        {
          id: "high",
          description: "Use GLM High reasoning effort",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" }
        },
        {
          id: "max",
          description: "Use GLM maximum reasoning effort",
          codexEffort: "xhigh",
          piLevel: "xhigh",
          openCodeOptions: { reasoningEffort: "max" }
        }
      ]
    }
  },
  {
    id: "auto",
    displayName: "Auto",
    contextWindow: 1048576,
    maxOutputTokens: 131000,
    modalities: { input: ["text"], output: ["text"] },
    reasoning: {
      defaultLevel: "auto",
      levels: [
        {
          id: "auto",
          description: "Let the Auto router pick the model per request",
          // Codex has no "auto" effort; pin the documented value that matches
          // this level's piLevel so config.toml never carries a bare "auto".
          codexEffort: "medium",
          piLevel: "medium",
          openCodeOptions: {}
        }
      ]
    }
  },
  {
    id: "kimi-k3",
    displayName: "Kimi K3",
    contextWindow: 1048576,
    maxOutputTokens: 1048576,
    modalities: { input: ["text", "image"], output: ["text"] },
    reasoning: {
      defaultLevel: "high",
      levels: [
        {
          id: "low",
          description: "Use Kimi low reasoning effort",
          piLevel: "low",
          openCodeOptions: { reasoningEffort: "low" }
        },
        {
          id: "high",
          description: "Use Kimi high reasoning effort",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" }
        },
        {
          id: "max",
          description: "Use Kimi maximum reasoning effort",
          codexEffort: "xhigh",
          piLevel: "xhigh",
          openCodeOptions: { reasoningEffort: "max" }
        }
      ]
    }
  }
] as const satisfies readonly ZroModel[];
