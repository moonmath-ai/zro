import {
  CATALOG_URL,
  ZRO_MODELS,
  type ZroModel,
  type ZroModelPricing,
  type ZroReasoningConfig,
} from "./constants.js";

/**
 * Shape returned by the control-plane `/api/cli/models` endpoint. Mirrors
 * `CliModelCatalog` in control-plane/web/lib/cli-model-catalog.ts. The
 * `reasoning` block carries the effort levels a model supports (`id` is the
 * native token the proxy accepts, e.g. "none"/"high"/"max"); the harness-specific
 * mappings next to each level (codexEffort, piLevel, openCodeOptions) are only
 * relevant to the CLI and are ignored here.
 */
interface RemoteReasoningLevel {
  id?: string;
  description?: string;
}

interface RemoteReasoning {
  defaultLevel?: string;
  levels?: readonly RemoteReasoningLevel[];
}

/**
 * Public pricing block, in USD per 1M tokens. Rates are already
 * promotion-adjusted by the control plane.
 */
interface RemotePricing {
  inputPer1M?: number;
  outputPer1M?: number;
  cacheReadPer1M?: number;
}

interface RemoteCatalogModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoning?: RemoteReasoning;
  pricing?: RemotePricing;
}

interface RemoteCatalog {
  default?: string;
  models?: readonly RemoteCatalogModel[];
}

export interface CatalogResult {
  default: string;
  models: readonly ZroModel[];
}

/**
 * Result used whenever the live catalog is unreachable, errors, or comes back
 * empty, so the model picker is never left with nothing to show.
 */
const FALLBACK_CATALOG: CatalogResult = { default: ZRO_MODELS[0].id, models: ZRO_MODELS };

/**
 * Fetch the live model catalog from the control plane, authenticated with the
 * same API key used for inference. Falls back to the static `ZRO_MODELS` list
 * when the endpoint is unreachable or returns an error, so the picker is never
 * empty.
 */
export async function fetchModelCatalog(
  apiKey: string,
  signal?: AbortSignal
): Promise<CatalogResult> {
  try {
    const response = await fetch(CATALOG_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) return FALLBACK_CATALOG;

    const catalog = (await response.json()) as RemoteCatalog;
    const models = (catalog.models ?? [])
      .filter((model) => typeof model.id === "string" && model.id.length > 0)
      .map<ZroModel>((model) => ({
        id: model.id,
        displayName: model.displayName ?? model.id,
        contextWindow: model.contextWindow ?? 128_000,
        maxOutputTokens: model.maxOutputTokens ?? 64_000,
        reasoning: parseReasoning(model.reasoning),
        pricing: parsePricing(model.pricing),
      }));

    if (models.length === 0) return FALLBACK_CATALOG;

    // `models` is non-empty here, so every branch yields a real id.
    const defaultId =
      catalog.default && models.some((model) => model.id === catalog.default)
        ? catalog.default
        : models[0].id;

    return { default: defaultId, models };
  } catch {
    return FALLBACK_CATALOG;
  }
}

/**
 * Normalize a catalog `reasoning` block. Returns undefined when the model has
 * no usable levels (reasoning control then stays hidden for that model).
 */
export function parseReasoning(
  reasoning: RemoteReasoning | undefined
): ZroReasoningConfig | undefined {
  const levels = (reasoning?.levels ?? [])
    .filter((level): level is RemoteReasoningLevel & { id: string } => typeof level?.id === "string" && level.id.length > 0)
    .map((level) => ({
      id: level.id,
      description: typeof level.description === "string" && level.description ? level.description : level.id,
    }));
  if (levels.length === 0) return undefined;
  const defaultLevel = reasoning?.defaultLevel;
  return {
    defaultLevel: levels.some((level) => level.id === defaultLevel) ? (defaultLevel as string) : levels[0].id,
    levels,
  };
}

/**
 * Normalize a catalog `pricing` block. Returns undefined unless both input and
 * output rates are present and sane, so a truncated or misconfigured block
 * hides the price entirely instead of showing a half-filled or `$NaN` one.
 * Cache-read is optional: not every model publishes a cache rate.
 */
export function parsePricing(
  pricing: RemotePricing | undefined
): ZroModelPricing | undefined {
  if (!pricing || typeof pricing !== "object") return undefined;
  const { inputPer1M, outputPer1M, cacheReadPer1M } = pricing;
  if (!isRate(inputPer1M) || !isRate(outputPer1M)) return undefined;
  return {
    inputPer1M,
    outputPer1M,
    ...(isRate(cacheReadPer1M) ? { cacheReadPer1M } : {}),
  };
}

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
