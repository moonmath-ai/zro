import { DEFAULT_ENDPOINT_ROOT } from "./engine/constants.js";

export interface ResolvedInference {
  root: string;
  baseUrl: string;
}

export function normalizeInferenceRoot(value: string, label = "inference URL"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}. Use an http(s) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid ${label}: ${value}. Use an http(s) URL.`);
  }
  if (url.search || url.hash) {
    throw new Error(`Invalid ${label}: ${value}. Remove the query string and fragment.`);
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (/\/v1$/i.test(pathname)) pathname = pathname.slice(0, -3);
  pathname = pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function resolveInference(
  env: NodeJS.ProcessEnv,
  flagValue?: string,
  requireExplicit = false,
): ResolvedInference {
  const explicit = flagValue ?? env.ZRO_INFERENCE_URL;
  if (requireExplicit && !explicit) {
    throw new Error(
      "No-auth mode needs an inference URL. Pass --inference-url or set ZRO_INFERENCE_URL.",
    );
  }
  const raw = explicit ?? env.ZRO_ENDPOINT_ROOT ?? DEFAULT_ENDPOINT_ROOT;
  const root = normalizeInferenceRoot(raw);
  return { root, baseUrl: `${root}/v1` };
}

export function resolveControlPlaneRoot(env: NodeJS.ProcessEnv): string {
  return normalizeInferenceRoot(
    env.ZRO_AUTH_URL || env.ZRO_ENDPOINT_ROOT || DEFAULT_ENDPOINT_ROOT,
    "control-plane URL",
  );
}

export function resolveMcpUrl(env: NodeJS.ProcessEnv): string {
  return env.ZRO_MCP_URL || `${resolveControlPlaneRoot(env)}/mcp/zro`;
}

export function isNoAuth(requestValue: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  return requestValue === true || env.ZRO_NO_AUTH === "1";
}
