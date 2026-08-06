import { CATALOG_URL, ZRO_MODELS, type ZroModel } from "./constants.js";

/**
 * Shape returned by the control-plane `/api/cli/models` endpoint. Mirrors
 * `CliModelCatalog` in control-plane/web/lib/cli-model-catalog.ts. Only the
 * fields the extension needs are modeled; `reasoning` is ignored here because
 * Copilot Chat's model picker has no reasoning-effort UI.
 */
interface RemoteCatalogModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
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
    if (!response.ok) return { default: ZRO_MODELS[0].id, models: ZRO_MODELS };

    const catalog = (await response.json()) as RemoteCatalog;
    const models = (catalog.models ?? [])
      .filter((model) => typeof model.id === "string" && model.id.length > 0)
      .map<ZroModel>((model) => ({
        id: model.id,
        displayName: model.displayName ?? model.id,
        contextWindow: model.contextWindow ?? 128_000,
        maxOutputTokens: model.maxOutputTokens ?? 64_000,
      }));

    if (models.length === 0) {
      return { default: ZRO_MODELS[0].id, models: ZRO_MODELS };
    }

    const fallbackDefault = ZRO_MODELS[0].id;
    const defaultId =
      catalog.default && models.some((model) => model.id === catalog.default)
        ? catalog.default
        : models[0].id;

    return { default: defaultId ?? fallbackDefault, models };
  } catch {
    return { default: ZRO_MODELS[0].id, models: ZRO_MODELS };
  }
}
