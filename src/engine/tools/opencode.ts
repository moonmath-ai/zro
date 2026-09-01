import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, PROVIDER_NAME, ZRO_ENV_KEY, type ZroModel } from "../constants.js";
import { json5Serializer, jsonSerializer } from "../serializers.js";
import type { LaunchFile, ToolModule } from "../types.js";
import { asPlainObject, objectAt } from "./helpers.js";

const CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"] as const;
const GENERATED_DIRECTORIES = new Set([".git", "node_modules"]);

export const opencodeTool: ToolModule = {
  id: "opencode",
  label: "opencode",
  async launch(ctx) {
    const configRoot = path.join(ctx.tempDir, "xdg");
    const opencodeRoot = path.join(configRoot, "opencode");
    const filePath = path.join(opencodeRoot, "opencode.json");
    const userConfigRoot = ctx.env.XDG_CONFIG_HOME ?? path.join(ctx.homeDir, ".config");
    const userOpencodeRoot = path.join(userConfigRoot, "opencode");
    const existing = await readOpenCodeConfig(userOpencodeRoot);
    const nextConfig = buildOpenCodeConfig(existing, ctx.apiKey, ctx.models, true);
    nextConfig.model = `${PROVIDER_ID}/${ctx.model}`;
    const userFiles = await collectUserConfigFiles(userOpencodeRoot, opencodeRoot);

    return {
      tool: "opencode",
      label: "opencode",
      model: ctx.model,
      command: "opencode",
      args: ctx.extraArgs,
      env: {
        XDG_CONFIG_HOME: configRoot,
        [ZRO_ENV_KEY]: ctx.apiKey,
        DO_NOT_TRACK: "1"
      },
      files: [
        { path: filePath, contents: jsonSerializer.stringify(nextConfig) },
        ...userFiles
      ],
      message: "Launch opencode with Zro"
    };
  }
};

async function readOpenCodeConfig(configRoot: string): Promise<Record<string, unknown>> {
  let config: Record<string, unknown> = {};
  for (const fileName of CONFIG_FILES) {
    const contents = await readOptionalFile(path.join(configRoot, fileName), "utf8");
    if (contents === undefined) continue;
    const parsed = json5Serializer.parse(contents) as Record<string, unknown>;
    config = mergeConfig(config, parsed);
  }
  return config;
}

function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseObject = asPlainObject(merged[key]);
    const overrideObject = asPlainObject(value);
    merged[key] = baseObject && overrideObject
      ? mergeConfig(baseObject, overrideObject)
      : value;
  }
  return merged;
}

async function collectUserConfigFiles(srcRoot: string, destRoot: string): Promise<LaunchFile[]> {
  const files: LaunchFile[] = [];
  const entries = await readOptionalDirectory(srcRoot);
  if (!entries) return files;

  const configFiles = new Set<string>(CONFIG_FILES);
  const ancestors = new Set([await fs.realpath(srcRoot)]);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (configFiles.has(entry.name) || GENERATED_DIRECTORIES.has(entry.name)) continue;
    await collectPath(
      path.join(srcRoot, entry.name),
      path.join(destRoot, entry.name),
      files,
      ancestors
    );
  }
  return files;
}

async function collectPath(
  srcPath: string,
  destPath: string,
  files: LaunchFile[],
  ancestorDirectories: Set<string>
): Promise<void> {
  const stats = await readOptionalStats(srcPath);
  if (!stats) return;
  if (stats.isFile()) {
    files.push({ path: destPath, contents: await fs.readFile(srcPath) });
    return;
  }
  if (!stats.isDirectory()) return;

  const realPath = await fs.realpath(srcPath);
  if (ancestorDirectories.has(realPath)) return;
  const nextAncestors = new Set(ancestorDirectories).add(realPath);
  const entries = await fs.readdir(srcPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (GENERATED_DIRECTORIES.has(entry.name)) continue;
    await collectPath(
      path.join(srcPath, entry.name),
      path.join(destPath, entry.name),
      files,
      nextAncestors
    );
  }
}

async function readOptionalDirectory(dirPath: string): Promise<Dirent[] | undefined> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function readOptionalFile(filePath: string, encoding: "utf8"): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function readOptionalStats(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function buildOpenCodeConfig(
  existing: Record<string, unknown>,
  apiKey: string,
  modelSpecs: readonly ZroModel[],
  useEnvReference = false
): Record<string, unknown> {
  const next = { ...existing };
  if (typeof next.$schema !== "string") {
    next.$schema = "https://opencode.ai/config.json";
  }

  const provider = objectAt(next, "provider");
  provider[PROVIDER_ID] = openAiCompatibleProvider(
    provider[PROVIDER_ID],
    apiKey,
    modelSpecs,
    useEnvReference
  );
  const mcp = objectAt(next, "mcp");
  mcp[PROVIDER_ID] = {
    type: "remote",
    url: MCP_URL,
    enabled: true,
    oauth: false,
    headers: {
      Authorization: `Bearer {env:${ZRO_ENV_KEY}}`
    }
  };
  return next;
}

function openAiCompatibleProvider(
  existing: unknown,
  apiKey: string,
  modelSpecs: readonly ZroModel[],
  useEnvReference = false
): Record<string, unknown> {
  const existingProvider = asPlainObject(existing) ?? {};
  const existingOptions = asPlainObject(existingProvider.options) ?? {};
  const models = { ...(asPlainObject(existingProvider.models) ?? {}) };
  for (const model of modelSpecs) {
    const existingModel = asPlainObject(models[model.id]) ?? {};
    const reasoningVariants = Object.fromEntries(
      model.reasoning.levels.map((level) => [level.id, level.openCodeOptions])
    );
    models[model.id] = {
      ...existingModel,
      name: model.id,
      reasoning: true,
      limit: {
        ...(asPlainObject(existingModel.limit) ?? {}),
        context: model.contextWindow,
        output: model.maxOutputTokens
      },
      variants: {
        ...reasoningVariants,
        ...(asPlainObject(existingModel.variants) ?? {})
      }
    };
  }

  return {
    ...existingProvider,
    npm: "@ai-sdk/openai-compatible",
    name: PROVIDER_NAME,
    options: {
      ...existingOptions,
      baseURL: BASE_URL,
      apiKey: useEnvReference ? `{env:${ZRO_ENV_KEY}}` : apiKey
    },
    models
  };
}
