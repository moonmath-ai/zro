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

export const SUPPORTED_TOOLS = ["claude", "codex", "codex-app", "grok", "kilo", "omp", "opencode", "hermes", "openclaw", "pi", "prime"] as const;
