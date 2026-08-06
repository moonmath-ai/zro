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

export interface ZroModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
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
    maxOutputTokens: 64000
  },
  {
    id: "kimi-k3",
    displayName: "Kimi K3",
    contextWindow: 1048576,
    maxOutputTokens: 64000
  }
];

export const DEFAULT_MODEL = ZRO_MODELS[0].id;
