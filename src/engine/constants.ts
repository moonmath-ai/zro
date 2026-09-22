export const ENDPOINT_ROOT = process.env.ZRO_ENDPOINT_ROOT ?? "https://zro.moonmath.ai";
export const BASE_URL = `${ENDPOINT_ROOT}/v1`;
export const MCP_URL = process.env.ZRO_MCP_URL ?? `${ENDPOINT_ROOT}/mcp/zro`;
export const ZRO_ENV_KEY = "ZRO_API_KEY";
export const PROVIDER_ID = "zro";
export const PROVIDER_NAME = "Zro";

export interface ZroReasoningLevel {
  id: string;
  description: string;
  codexEffort?: string;
  piLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  openCodeOptions: Readonly<Record<string, unknown>>;
}

export interface ZroReasoningConfig {
  defaultLevel: string;
  levels: readonly ZroReasoningLevel[];
}

export type ZroModality = "text" | "image" | "video" | "audio" | "pdf";

export interface ZroModalities {
  input: readonly ZroModality[];
  output: readonly ZroModality[];
}

export interface ZroModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  modalities: ZroModalities;
  reasoning: ZroReasoningConfig;
}

/** True when a model accepts non-text input (image/video/audio/pdf). */
export function supportsAttachments(model: Pick<ZroModel, "modalities">): boolean {
  return model.modalities.input.some((modality) => modality !== "text");
}

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

export const DEFAULT_MODEL = "deepseek-v4.1-flash";

export const SUPPORTED_TOOLS = ["claude", "codex", "codex-app", "grok", "kilo", "omp", "opencode", "hermes", "openclaw", "pi", "prime"] as const;
