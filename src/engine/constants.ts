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

export interface ZroModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: ZroReasoningConfig;
}

export const ZRO_MODELS = [
  {
    id: "minimax-m3",
    displayName: "MiniMax M3",
    contextWindow: 1048576,
    maxOutputTokens: 64000,
    reasoning: {
      defaultLevel: "adaptive",
      levels: [
        {
          id: "disabled",
          description: "Disable reasoning for the lowest latency",
          piLevel: "off",
          openCodeOptions: { thinking: { type: "disabled" } }
        },
        {
          id: "adaptive",
          description: "Reason only when MiniMax determines it is useful",
          piLevel: "medium",
          openCodeOptions: { thinking: { type: "adaptive" } }
        },
        {
          id: "enabled",
          description: "Reason before every response",
          piLevel: "high",
          openCodeOptions: { thinking: { type: "enabled" } }
        }
      ]
    }
  },
  {
    id: "glm-5.2",
    displayName: "GLM-5.2",
    contextWindow: 524288,
    maxOutputTokens: 64000,
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
    id: "kimi-k2.7-code",
    displayName: "Kimi K2.7 Code",
    contextWindow: 128000,
    maxOutputTokens: 64000,
    reasoning: {
      defaultLevel: "high",
      levels: [
        {
          id: "high",
          description: "Kimi always reasons before responding",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" }
        }
      ]
    }
  }
] as const satisfies readonly ZroModel[];

export const DEFAULT_MODEL = ZRO_MODELS[0].id;

export const SUPPORTED_TOOLS = ["claude", "codex", "codex-app", "grok", "kilo", "opencode", "hermes", "openclaw", "pi"] as const;
