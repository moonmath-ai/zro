import fs from "node:fs/promises";
import path from "node:path";
import {
  type ZroModel,
  type ZroModality,
  type ZroModalities,
} from "./engine/constants.js";
import { resolveControlPlaneRoot } from "./endpoints.js";

export interface ModelCatalog {
  version: 1;
  default: string;
  models: readonly ZroModel[];
}

export type CatalogSource = "remote" | "cache";

export interface LoadedModelCatalog extends ModelCatalog {
  source: CatalogSource;
}

type CatalogOptions = {
  apiKey?: string;
  cacheRemote?: boolean;
  noAuth?: boolean;
  inferenceRoot?: string;
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

export class CatalogUnavailableError extends Error {
  constructor(reason: string) {
    super(`Could not reach the Zro model catalog (${reason}). Check your connection and try again.`);
    this.name = "CatalogUnavailableError";
  }
}

export async function loadModelCatalog(options: CatalogOptions): Promise<LoadedModelCatalog> {
  if (options.noAuth) return loadPublicCatalog(options, options.inferenceRoot);

  let fetchFailure: unknown;
  if (options.apiKey) {
    try {
      const catalog = await fetchAuthenticatedCatalog(options, options.apiKey);
      if (options.cacheRemote !== false) {
        await writeCachedCatalog(options, catalog).catch(() => {});
      }
      return { ...catalog, source: "remote" };
    } catch (error) {
      if (error instanceof CatalogAuthenticationError) {
        await invalidateModelCatalog(options).catch(() => {});
        throw error;
      }
      fetchFailure = error;
    }
  }

  const cached = await readCachedCatalog(options);
  if (cached) return { ...cached, source: "cache" };

  if (fetchFailure) {
    throw new CatalogUnavailableError(fetchFailure instanceof Error ? fetchFailure.message : String(fetchFailure));
  }
  throw new Error("No model catalog is available. Run zro login to load models.");
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

export function publicModelCatalogCachePath(options: Pick<CatalogOptions, "env" | "homeDir">): string {
  const cacheRoot = options.env.XDG_CACHE_HOME || path.join(options.homeDir, ".cache");
  return path.join(cacheRoot, "zro", "model-catalog-public.json");
}

async function fetchAuthenticatedCatalog(options: CatalogOptions, apiKey: string): Promise<ModelCatalog> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const endpointRoot = catalogRoot(options.env);
  const response = await fetcher(`${endpointRoot}/api/cli/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });

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

function catalogRoot(env: NodeJS.ProcessEnv): string {
  return resolveControlPlaneRoot(env);
}

async function loadPublicCatalog(
  options: CatalogOptions,
  inferenceRoot: string | undefined,
): Promise<LoadedModelCatalog> {
  if (!inferenceRoot) {
    throw new Error("No-auth mode needs an inference URL. Pass --inference-url or set ZRO_INFERENCE_URL.");
  }

  let source: CatalogSource = "remote";
  let catalog: ModelCatalog | null = null;
  let fetchFailure: unknown;
  try {
    catalog = await fetchPublicCatalog(options);
    if (options.cacheRemote !== false) {
      await writePublicCachedCatalog(options, catalog).catch(() => {});
    }
  } catch (error) {
    fetchFailure = error;
  }

  if (!catalog) {
    catalog = await readPublicCachedCatalog(options);
    source = "cache";
  }
  if (!catalog) {
    throw new CatalogUnavailableError(
      fetchFailure instanceof Error ? fetchFailure.message : String(fetchFailure ?? "no cached catalog"),
    );
  }

  const activeIds = await fetchActiveModelIds(options, inferenceRoot);
  return { ...intersectCatalog(catalog, activeIds), source };
}

async function fetchPublicCatalog(options: CatalogOptions): Promise<ModelCatalog> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(`${catalogRoot(options.env)}/api/cli/models/public`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Public model catalog request failed with HTTP ${response.status}.`);
  }
  return parseModelCatalog(await response.json());
}

async function fetchActiveModelIds(options: CatalogOptions, inferenceRoot: string): Promise<Set<string>> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const root = inferenceRoot.replace(/\/+$/, "");
  const response = await fetcher(`${root}/v1/models`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Inference gateway model list request failed with HTTP ${response.status}.`);
  }
  return parseActiveModelIds(await response.json());
}

function parseActiveModelIds(value: unknown): Set<string> {
  const data = asRecord(value, "inference gateway model list").data;
  if (!Array.isArray(data)) throw new Error("Invalid inference gateway model list.");
  const ids = new Set<string>();
  for (const entry of data) {
    const id = asRecord(entry, "inference gateway model").id;
    if (typeof id === "string" && id.trim()) ids.add(id.replace(/^zro\//, ""));
  }
  return ids;
}

function intersectCatalog(catalog: ModelCatalog, activeIds: Set<string>): ModelCatalog {
  const models = catalog.models.filter((model) => activeIds.has(model.id));
  if (models.length === 0) {
    throw new Error("The inference gateway does not offer any public models.");
  }
  const defaultModel = models.some((model) => model.id === catalog.default)
    ? catalog.default
    : models[0].id;
  return { version: 1, default: defaultModel, models };
}

async function readPublicCachedCatalog(options: CatalogOptions): Promise<ModelCatalog | null> {
  try {
    const contents = await fs.readFile(publicModelCatalogCachePath(options), "utf8");
    return parseModelCatalog(JSON.parse(contents));
  } catch {
    return null;
  }
}

async function writePublicCachedCatalog(options: CatalogOptions, catalog: ModelCatalog): Promise<void> {
  const filePath = publicModelCatalogCachePath(options);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
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