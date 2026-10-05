import fs from "node:fs/promises";
import path from "node:path";
import {
  BASE_URL,
  MCP_URL,
  PROVIDER_ID,
  PROVIDER_NAME,
  ZRO_ENV_KEY,
  type ZroModel,
} from "../constants.js";
import { json5Serializer, jsonSerializer } from "../serializers.js";
import type { LaunchFile, ToolModule } from "../types.js";
import { asPlainObject } from "./helpers.js";

const CONFIG_FILES = ["config.json", "kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc"] as const;
const SAFE_ASSET_NAMES = new Set([
  "AGENTS.md",
  "agent",
  "agents",
  "command",
  "commands",
  "mode",
  "modes",
  "plugin",
  "plugins",
  "skill",
  "skills",
]);
const SKIPPED_ASSET_NAMES = new Set([
  ".git",
  ".DS_Store",
  "node_modules",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".env",
  ".npmrc",
  ".netrc",
  "auth.json",
  "credentials.json",
  "accounts.json",
  "sessions",
  "cache",
  "state",
  "logs",
  "telemetry",
]);
const SAFE_TOP_LEVEL_KEYS = [
  "shell",
  "logLevel",
  "watcher",
  "snapshot",
  "auto_collapse_reasoning",
  "console",
  "terminal_command_display",
  "code_edit_display",
  "hide_prompt_training_models",
  "sandbox",
  "default_agent",
  "username",
  "permission",
  "tools",
  "attachment",
  "commit_message",
  "tool_output",
  "compaction",
] as const;
const SAFE_AGENT_KEYS = [
  "temperature",
  "top_p",
  "prompt",
  "description",
  "mode",
  "displayName",
  "source",
  "hidden",
  "color",
  "steps",
  "maxSteps",
  "permission",
  "disable",
  "tools",
] as const;
const SAFE_COMMAND_KEYS = ["template", "description", "agent", "subtask"] as const;

export const kiloTool: ToolModule = {
  id: "kilo",
  label: "Kilo Code",
  async launch(ctx) {
    const isolatedHome = path.join(ctx.tempDir, "home");
    const xdgRoot = path.join(ctx.tempDir, "xdg");
    const configHome = path.join(xdgRoot, "config");
    const dataHome = path.join(xdgRoot, "data");
    const cacheHome = path.join(xdgRoot, "cache");
    const stateHome = path.join(xdgRoot, "state");
    const kiloConfigRoot = path.join(configHome, "kilo");
    const userConfigHome = ctx.env.XDG_CONFIG_HOME ?? path.join(ctx.homeDir, ".config");
    const userKiloRoot = path.join(userConfigHome, "kilo");
    const existing = await readKiloConfig(userKiloRoot);
    const safeConfig = sanitizeKiloConfig(existing);
    const overlay = buildKiloConfigOverlay(ctx.model, ctx.models);
    const userFiles = await collectSafeUserAssets(userKiloRoot, kiloConfigRoot);

    return {
      tool: "kilo",
      label: "Kilo Code",
      model: ctx.model,
      command: "kilo",
      args: ctx.extraArgs,
      env: {
        HOME: isolatedHome,
        XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: dataHome,
        XDG_CACHE_HOME: cacheHome,
        XDG_STATE_HOME: stateHome,
        KILO_CONFIG: "",
        KILO_CONFIG_DIR: kiloConfigRoot,
        KILO_CONFIG_CONTENT: JSON.stringify(overlay),
        KILO_DB: "kilo.db",
        KILO_TELEMETRY_LEVEL: "off",
        KILO_DISABLE_AUTOUPDATE: "1",
        KILO_DISABLE_MODELS_FETCH: "1",
        KILO_DISABLE_SESSION_INGEST: "1",
        KILO_DISABLE_SHARE: "1",
        KILO_DISABLE_DEFAULT_PLUGINS: "1",
        KILO_AUTO_SHARE: "0",
        KILO_REMOTE: "0",
        KILO_AUTO_HEAP_SNAPSHOT: "0",
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_HEADERS: "",
        DO_NOT_TRACK: "1",
        [ZRO_ENV_KEY]: ctx.apiKey,
      },
      files: [
        {
          path: path.join(kiloConfigRoot, "kilo.json"),
          contents: jsonSerializer.stringify(safeConfig),
        },
        ...userFiles,
      ],
      message: "Launch Kilo Code with Zro",
    };
  },
};

export function buildKiloConfigOverlay(
  model: string,
  modelSpecs: readonly ZroModel[],
): Record<string, unknown> {
  const models = Object.fromEntries(modelSpecs.map((spec) => [
    spec.id,
    {
      name: spec.displayName,
      tool_call: true,
      reasoning: true,
      limit: {
        context: spec.contextWindow,
        output: spec.maxOutputTokens,
      },
      variants: Object.fromEntries(
        spec.reasoning.levels.map((level) => [level.id, level.openCodeOptions]),
      ),
    },
  ]));

  return {
    $schema: "https://app.kilo.ai/config.json",
    model: `${PROVIDER_ID}/${model}`,
    enabled_providers: [PROVIDER_ID],
    provider: {
      [PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: PROVIDER_NAME,
        options: {
          baseURL: BASE_URL,
          apiKey: `{env:${ZRO_ENV_KEY}}`,
        },
        models,
      },
    },
    mcp: {
      [PROVIDER_ID]: {
        type: "remote",
        url: MCP_URL,
        headers: {
          Authorization: `Bearer {env:${ZRO_ENV_KEY}}`,
        },
        enabled: true,
        oauth: false,
      },
    },
    experimental: {
      openTelemetry: false,
    },
    autoupdate: false,
    remote_control: false,
    share: "disabled",
  };
}

async function readKiloConfig(configRoot: string): Promise<Record<string, unknown>> {
  let config: Record<string, unknown> = {};
  for (const fileName of CONFIG_FILES) {
    const contents = await readOptionalFile(path.join(configRoot, fileName));
    if (contents === undefined) continue;
    config = mergeConfig(config, json5Serializer.parse(contents) as Record<string, unknown>);
  }
  return config;
}

function sanitizeKiloConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {
    $schema: "https://app.kilo.ai/config.json",
  };

  for (const key of SAFE_TOP_LEVEL_KEYS) {
    if (Object.hasOwn(config, key)) safe[key] = config[key];
  }

  const agents = sanitizeNamedObjects(config.agent, SAFE_AGENT_KEYS);
  if (agents) safe.agent = agents;
  const modes = sanitizeNamedObjects(config.mode, SAFE_AGENT_KEYS);
  if (modes) safe.mode = modes;
  const commands = sanitizeNamedObjects(config.command, SAFE_COMMAND_KEYS);
  if (commands) safe.command = commands;

  if (Array.isArray(config.instructions)) {
    const instructions = config.instructions.filter(
      (value): value is string => typeof value === "string" && !isRemoteReference(value),
    );
    if (instructions.length) safe.instructions = instructions;
  }

  if (Array.isArray(config.plugin)) {
    const plugins = config.plugin.filter(
      (value): value is string => typeof value === "string" && isSafePluginReference(value),
    );
    if (plugins.length) safe.plugin = plugins;
  }

  return safe;
}

function sanitizeNamedObjects(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | undefined {
  const entries = asPlainObject(value);
  if (!entries) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [name, candidate] of Object.entries(entries)) {
    const source = asPlainObject(candidate);
    if (!source) continue;
    const next: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (Object.hasOwn(source, key)) next[key] = source[key];
    }
    safe[name] = next;
  }
  return Object.keys(safe).length ? safe : undefined;
}

function isRemoteReference(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

function isSafePluginReference(value: string): boolean {
  if (isRemoteReference(value)) return false;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith("file:");
}

function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
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

async function collectSafeUserAssets(srcRoot: string, destRoot: string): Promise<LaunchFile[]> {
  const files: LaunchFile[] = [];
  const entries = await readOptionalDirectory(srcRoot);
  if (!entries) return files;

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!SAFE_ASSET_NAMES.has(entry.name)) continue;
    await collectSafePath(
      path.join(srcRoot, entry.name),
      path.join(destRoot, entry.name),
      files,
    );
  }
  return files;
}

async function collectSafePath(
  srcPath: string,
  destPath: string,
  files: LaunchFile[],
): Promise<void> {
  const stats = await readOptionalLstat(srcPath);
  if (!stats || stats.isSymbolicLink()) return;
  if (stats.isFile()) {
    files.push({ path: destPath, contents: await fs.readFile(srcPath) });
    return;
  }
  if (!stats.isDirectory()) return;

  const entries = await fs.readdir(srcPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (isSensitiveAssetName(entry.name)) continue;
    await collectSafePath(
      path.join(srcPath, entry.name),
      path.join(destPath, entry.name),
      files,
    );
  }
}

function isSensitiveAssetName(name: string): boolean {
  if (SKIPPED_ASSET_NAMES.has(name)) return true;
  if (/^\.env(?:\.|$)/i.test(name)) return true;
  if (/^(?:auth|accounts?|credentials?|tokens?|mcp-tokens?)(?:\.|$)/i.test(name)) return true;
  return /\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/i.test(name);
}

async function readOptionalDirectory(dirPath: string): Promise<import("node:fs").Dirent[] | undefined> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function readOptionalLstat(filePath: string): Promise<import("node:fs").Stats | undefined> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}
