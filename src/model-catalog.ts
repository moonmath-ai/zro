import fs from "node:fs/promises";
import path from "node:path";
import {
  ENDPOINT_ROOT,
  type ZroModel,
  type ZroModality,
  type ZroModalities,
  type ZroReasoningConfig,
  type ZroReasoningLevel,
} from "./engine/constants.js";

export interface ModelCatalog {
  version: 1;
  default: string;
  models: readonly ZroModel[];
}

type CatalogOptions = {
  apiKey?: string;
  cacheRemote?: boolean;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

export class CatalogAuthenticationError extends Error {
  constructor(public readonly status: number) {
    super(`Zro rejected the API key (HTTP ${status}).`);
    this.name = "CatalogAuthenticationError";
  }
}

export async function loadModelCatalog(options: CatalogOptions): Promise<ModelCatalog> {
  if (options.apiKey) {
    try {
      const catalog = await fetchAuthenticatedCatalog(options, options.apiKey);
      if (options.cacheRemote !== false) {
        await writeCachedCatalog(options, catalog).catch(() => {});
      }
      return catalog;
    } catch (error) {
      if (error instanceof CatalogAuthenticationError) {
        await invalidateModelCatalog(options).catch(() => {});
        throw error;
      }
    }
  }

  const cached = await readCachedCatalog(options);
  if (cached) return cached;

  const catalog = await fetchPublicCatalog(options);
  // Only persist the public fallback for signed-out users. When a key was
  // present but the control plane was transiently unavailable, leave the
  // cache untouched so the next run retries the full authenticated catalog.
  if (!options.apiKey && options.cacheRemote !== false) {
    await writeCachedCatalog(options, catalog).catch(() => {});
  }
  return catalog;
}

export async function invalidateModelCatalog(
  options: Pick<CatalogOptions, "env" | "homeDir">,
): Promise<void> {
  try {
    await fs.rm(modelCatalogCachePath(options));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export function modelCatalogCachePath(options: Pick<CatalogOptions, "env" | "homeDir">): string {
  const cacheRoot = options.env.XDG_CACHE_HOME || path.join(options.homeDir, ".cache");
  return path.join(cacheRoot, "zro", "model-catalog.json");
}

async function fetchAuthenticatedCatalog(options: CatalogOptions, apiKey: string): Promise<ModelCatalog> {
  const response = await requestCatalog(options, "/api/cli/models", apiKey);

  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => {});
    throw new CatalogAuthenticationError(response.status);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Model catalog request failed with HTTP ${response.status}.`);
  }

  return parseModelCatalog(await response.json());
}

async function fetchPublicCatalog(options: CatalogOptions): Promise<ModelCatalog> {
  const response = await requestCatalog(options, "/models");
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Model catalog request failed with HTTP ${response.status}.`);
  }
  return parsePublicCatalog(await response.json());
}

function requestCatalog(options: CatalogOptions, pathname: string, apiKey?: string): Promise<Response> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const endpointRoot = catalogRoot(options.env);
  return fetcher(`${endpointRoot}${pathname}`, {
    ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    signal: AbortSignal.timeout(5_000),
  });
}

function catalogRoot(env: NodeJS.ProcessEnv): string {
  return (env.ZRO_AUTH_URL || env.ZRO_ENDPOINT_ROOT || ENDPOINT_ROOT).replace(/\/+$/, "");
}

async function readCachedCatalog(options: CatalogOptions): Promise<ModelCatalog | null> {
  try {
    const contents = await fs.readFile(modelCatalogCachePath(options), "utf8");
    return parseModelCatalog(JSON.parse(contents));
  } catch {
    return null;
  }
}

async function writeCachedCatalog(options: CatalogOptions, catalog: ModelCatalog): Promise<void> {
  const filePath = modelCatalogCachePath(options);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

export function parseModelCatalog(value: unknown): ModelCatalog {
  const root = asRecord(value, "catalog");
  if (root.version !== 1) throw new Error("Unsupported model catalog version.");
  if (!Array.isArray(root.models) || root.models.length === 0) {
    throw new Error("The model catalog is empty.");
  }

  const models = root.models.map(parseModel);
  const ids = new Set(models.map((model) => model.id));
  if (ids.size !== models.length) throw new Error("The model catalog contains duplicate IDs.");
  if (typeof root.default !== "string" || !ids.has(root.default)) {
    throw new Error("The model catalog default is invalid.");
  }

  return { version: 1, default: root.default, models };
}

function parseModel(value: unknown): ZroModel {
  const model = asRecord(value, "model");
  const reasoning = asRecord(model.reasoning, "model reasoning");
  if (!Array.isArray(reasoning.levels) || reasoning.levels.length === 0) {
    throw new Error("A model has no reasoning levels.");
  }
  const levels = reasoning.levels.map((value) => {
    const level = asRecord(value, "reasoning level");
    const piLevel = requiredString(level.piLevel, "reasoning piLevel");
    if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(piLevel)) {
      throw new Error("A model has an invalid reasoning piLevel.");
    }
    const openCodeOptions = asRecord(level.openCodeOptions, "reasoning options");
    return {
      id: requiredString(level.id, "reasoning level ID"),
      description: requiredString(level.description, "reasoning description"),
      ...(typeof level.codexEffort === "string" ? { codexEffort: level.codexEffort } : {}),
      piLevel: piLevel as ZroModel["reasoning"]["levels"][number]["piLevel"],
      openCodeOptions,
    };
  });
  const defaultLevel = requiredString(reasoning.defaultLevel, "default reasoning level");
  if (!levels.some((level) => level.id === defaultLevel)) {
    throw new Error("A model has an invalid default reasoning level.");
  }

  return {
    id: requiredString(model.id, "model ID"),
    displayName: requiredString(model.displayName, "model display name"),
    contextWindow: positiveInteger(model.contextWindow, "context window"),
    maxOutputTokens: positiveInteger(model.maxOutputTokens, "max output tokens"),
    modalities: parseModalities(model.modalities),
    reasoning: { defaultLevel, levels },
  };
}

type PublicModel = {
  id: string;
  name: string;
  context_length: number;
  max_output_length: number;
  input_modalities: string[];
  output_modalities: string[];
  supported_features?: string[];
};

export function parsePublicCatalog(value: unknown): ModelCatalog {
  const root = asRecord(value, "catalog");
  if (!Array.isArray(root.data) || root.data.length === 0) {
    throw new Error("The model catalog is empty.");
  }

  const models = root.data.map(parsePublicModel);
  // The public endpoint does not name a default; the server controls the
  // ordering, so the first model is the default.
  return { version: 1, default: models[0].id, models };
}

function parsePublicModel(value: unknown): ZroModel {
  const model = asRecord(value, "model") as Partial<PublicModel>;
  return {
    id: requiredString(model.id, "model ID"),
    displayName: requiredString(model.name, "model display name"),
    contextWindow: positiveInteger(model.context_length, "context length"),
    maxOutputTokens: positiveInteger(model.max_output_length, "max output length"),
    modalities: {
      input: parseModalityList(model.input_modalities, "input"),
      output: parseModalityList(model.output_modalities, "output"),
    },
    reasoning: synthesizeReasoningConfig(model.supported_features),
  };
}

function synthesizeReasoningConfig(supportedFeatures: string[] | undefined): ZroReasoningConfig {
  const reasoning = Array.isArray(supportedFeatures) && supportedFeatures.includes("reasoning");
  if (!reasoning) {
    return {
      defaultLevel: "none",
      levels: [reasoningLevel("none", "off", "none")],
    };
  }
  return {
    defaultLevel: "high",
    levels: [
      reasoningLevel("none", "off", "none", "disabled"),
      reasoningLevel("low", "low", "low"),
      reasoningLevel("high", "high", "high"),
      reasoningLevel("max", "xhigh", "max", "xhigh"),
    ],
  };
}

function reasoningLevel(
  id: string,
  piLevel: ZroReasoningLevel["piLevel"],
  effort: string,
  codexEffort?: string,
): ZroReasoningLevel {
  return {
    id,
    description: `Use ${id} reasoning effort`,
    ...(codexEffort ? { codexEffort } : {}),
    piLevel,
    openCodeOptions: { reasoningEffort: effort },
  };
}

const KNOWN_MODALITIES = new Set<string>(["text", "image", "video", "audio", "pdf"]);

function parseModalities(value: unknown): ZroModalities {
  // Older catalogs may omit the field entirely; default to text-only rather
  // than rejecting cached catalogs on disk.
  if (value === undefined) return { input: ["text"], output: ["text"] };

  const modalities = asRecord(value, "model modalities");
  const input = parseModalityList(modalities.input, "input");
  const output = parseModalityList(modalities.output, "output");
  return { input, output };
}

function parseModalityList(value: unknown, label: string): readonly ZroModality[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`A model has no ${label} modalities.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !KNOWN_MODALITIES.has(entry)) {
      throw new Error(`A model has an invalid ${label} modality.`);
    }
    return entry as ZroModality;
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${label}.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}