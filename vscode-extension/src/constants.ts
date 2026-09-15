// Static fallback catalog mirroring zro/src/engine/constants.ts. The extension
// is CommonJS while the CLI is ESM, so we carry a copy. At runtime the provider
// fetches the live catalog from the control plane (`/api/cli/models`) and only
// falls back to this list when the endpoint is unreachable.

export const ENDPOINT_ROOT = process.env.ZRO_ENDPOINT_ROOT ?? "https://zro.moonmath.ai";
export const BASE_URL = `${ENDPOINT_ROOT}/v1`;
export const CATALOG_URL = `${ENDPOINT_ROOT}/api/cli/models`;
export const STATUS_URL = `${ENDPOINT_ROOT}/api/cli/status`;
export const ZRO_ENV_KEY = "ZRO_API_KEY";

/**
 * Auth endpoint root. Mirrors the CLI's `getAuthRoot()` resolution: an explicit
 * auth URL wins, then the deployment-specific endpoint root, then the default.
 * Used by the device-code OAuth login flow to reach the control-plane auth API.
 */
export function getAuthRoot(): string {
  return (process.env.ZRO_AUTH_URL || process.env.ZRO_ENDPOINT_ROOT || ENDPOINT_ROOT).replace(/\/+$/, "");
}

/**
 * Rewrite the server-provided approval URL onto a public root when present.
 * Mirrors the CLI's `browserApprovalUrl()`.
 */
export function browserApprovalUrl(serverUrl: string): string {
  const publicRoot = process.env.ZRO_PUBLIC_URL || process.env.ZRO_AUTH_URL;
  if (!publicRoot) return serverUrl;
  const url = new URL(serverUrl);
  return new URL(`${url.pathname}${url.search}${url.hash}`, new URL(publicRoot)).toString();
}

export const PROVIDER_ID = "zro";
export const PROVIDER_NAME = "ZRO";

/**
 * A single reasoning-effort level a model supports. Mirrors
 * `ZroReasoningLevel` in zro/src/engine/constants.ts — only the fields the
 * extension needs (`id`, `description`) are carried; the harness-specific
 * mappings (codexEffort, piLevel, openCodeOptions) live on the CLI side.
 */
export interface ZroReasoningLevel {
  id: string;
  description: string;
}

/** Per-model reasoning configuration advertised by the catalog. */
export interface ZroReasoningConfig {
  defaultLevel: string;
  levels: readonly ZroReasoningLevel[];
}

export interface ZroModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning?: ZroReasoningConfig;
}

/** Static fallback used when the live catalog cannot be fetched. */
export const ZRO_MODELS: readonly ZroModel[] = [
  {
    id: "minimax-m3",
    displayName: "MiniMax M3",
    contextWindow: 1048576,
    maxOutputTokens: 64000
  },
  {
    id: "glm-5.2",
    displayName: "GLM-5.2",
    contextWindow: 524288,
    maxOutputTokens: 64000,
    reasoning: {
      defaultLevel: "max",
      levels: [
        { id: "none", description: "Disable reasoning for the lowest latency" },
        { id: "high", description: "Use GLM High reasoning effort" },
        { id: "max", description: "Use GLM maximum reasoning effort" }
      ]
    }
  },
  {
    id: "kimi-k3",
    displayName: "Kimi K3",
    contextWindow: 1048576,
    maxOutputTokens: 64000,
    reasoning: {
      defaultLevel: "high",
      levels: [
        { id: "low", description: "Use Kimi low reasoning effort" },
        { id: "high", description: "Use Kimi high reasoning effort" },
        { id: "max", description: "Use Kimi maximum reasoning effort" }
      ]
    }
  }
];

export const DEFAULT_MODEL = ZRO_MODELS[0].id;

/** VS Code settings that control reasoning effort (see package.json configuration). */
export const CONFIG_SECTION = "zro";
export const SETTING_REASONING_EFFORT = "reasoningEffort";
export const SETTING_REASONING_EFFORT_BY_MODEL = "reasoningEffortByModel";

/**
 * Sentinel for "no explicit effort": the proxy then applies the model's native
 * `defaultLevel`, and the extension omits `reasoning_effort` from the request.
 */
export const EFFORT_DEFAULT = "default";

/**
 * Effort levels valid in `zro.reasoningEffort`, on top of `EFFORT_DEFAULT`.
 * The union of every level the catalog has ever advertised — a model only ever
 * sees levels from its own `.reasoning.levels`, so out-of-level values here are
 * simply ignored per model. "medium" and "xhigh" are reserved for future models.
 */
