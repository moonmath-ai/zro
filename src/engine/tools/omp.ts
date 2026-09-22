import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  MCP_URL,
  PROVIDER_ID,
  ZRO_ENV_KEY,
  type ZroModel,
} from "../constants.js";
import { json5Serializer, jsonSerializer, yamlSerializer } from "../serializers.js";
import type { LaunchFile, ToolModule } from "../types.js";

const OMP_CONFIG_DIR = ".omp";
const OMP_MCP_AUTH_ENV_KEY = "ZRO_MCP_AUTHORIZATION";
const OMP_MCP_SCHEMA = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";
const OMP_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const OMP_OFF_FALLBACK_LEVEL = "minimal";
const OMP_ZAI_THINKING_FORMAT_MODELS = new Set<string>();
const MODEL_ROLES = [
  "default",
  "smol",
  "slow",
  "vision",
  "plan",
  "designer",
  "commit",
  "tiny",
  "task",
  "advisor",
] as const;

const SAFE_CONFIG_KEYS = [
  "theme",
  "symbolPreset",
  "colorBlindMode",
  "statusLine",
  "terminal",
  "images",
  "collapseChangelog",
  "steeringMode",
  "queueMode",
  "defaultThinkingLevel",
  "hideThinkingBlock",
  "omitThinking",
  "markdown",
  "editor",
  "input",
  "git",
] as const;

const SAFE_ASSET_NAMES = new Set(["agents", "commands", "prompts", "skills", "themes"]);
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
  "agent.db",
  "auth.json",
  "credentials.json",
  "accounts.json",
  "sessions",
  "cache",
  "state",
  "logs",
  "telemetry",
]);

export const ompTool: ToolModule = {
  id: "omp",
  label: "Oh My Pi",
  async launch(ctx) {
    const isolatedHome = path.join(ctx.tempDir, "home");
    const xdgRoot = path.join(ctx.tempDir, "xdg");
    const configHome = path.join(xdgRoot, "config");
    const dataHome = path.join(xdgRoot, "data");
    const cacheHome = path.join(xdgRoot, "cache");
    const stateHome = path.join(xdgRoot, "state");
    const configRoot = path.join(isolatedHome, OMP_CONFIG_DIR);
    const agentDir = path.join(configRoot, "agent");
    const overlayPath = path.join(agentDir, "zro.yml");
    const userAgentDir = resolveUserAgentDir(ctx.homeDir, ctx.env);
    const safeConfig = sanitizeOmpConfig(await readUserConfig(userAgentDir));
    const userFiles = await collectSafeUserAssets(userAgentDir, agentDir);

    return {
      tool: "omp",
      label: "Oh My Pi",
      model: ctx.model,
      command: "omp",
      args: ctx.extraArgs,
      env: {
        HOME: isolatedHome,
        XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: dataHome,
        XDG_CACHE_HOME: cacheHome,
        XDG_STATE_HOME: stateHome,
        PI_CONFIG_DIR: OMP_CONFIG_DIR,
        PI_CODING_AGENT_DIR: agentDir,
        PI_CONFIG_FILES: overlayPath,
        OMP_PROFILE: "",
        PI_PROFILE: "",
        OMP_AUTH_BROKER_URL: "",
        OMP_AUTH_BROKER_TOKEN: "",
        OMP_AUTH_BROKER_SNAPSHOT_TTL_MS: "0",
        PI_AUTO_QA: "0",
        PI_AUTO_QA_PUSH: "0",
        PI_AUTO_QA_PUSH_URL: "",
        PI_AUTO_QA_PUSH_TOKEN: "",
        OTEL_SDK_DISABLED: "true",
        OTEL_TRACES_EXPORTER: "none",
        OTEL_LOGS_EXPORTER: "none",
        OTEL_METRICS_EXPORTER: "none",
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_HEADERS: "",
        DO_NOT_TRACK: "1",
        NO_UPDATE_NOTIFIER: "1",
        [OMP_MCP_AUTH_ENV_KEY]: `Bearer ${ctx.apiKey}`,
        [ZRO_ENV_KEY]: ctx.apiKey,
      },
      files: [
        {
          path: path.join(agentDir, "config.yml"),
          contents: yamlSerializer.stringify(safeConfig),
        },
        {
          path: overlayPath,
          contents: yamlSerializer.stringify(buildOmpConfigOverlay(ctx.model, ctx.models)),
        },
        {
          path: path.join(agentDir, "models.yml"),
          contents: yamlSerializer.stringify(buildOmpModelsConfig(ctx.models)),
        },
        {
          path: path.join(agentDir, "mcp.json"),
          contents: jsonSerializer.stringify(buildOmpMcpConfig()),
        },
        ...userFiles,
      ],
      message: "Launch Oh My Pi with Zro",
    };
  },
};

export function buildOmpConfigOverlay(
  model: string,
  modelSpecs: readonly ZroModel[],
): Record<string, unknown> {
  const modelSpec = modelSpecs.find((candidate) => candidate.id === model);
  const thinkingLevel = modelSpec ? defaultThinkingLevel(modelSpec) : undefined;
  const selector = `${PROVIDER_ID}/${model}${thinkingLevel ? `:${thinkingLevel}` : ""}`;

  return {
    enabledModels: [`${PROVIDER_ID}/*`],
    modelRoles: Object.fromEntries(MODEL_ROLES.map((role) => [role, selector])),
    startup: {
      quiet: true,
      showSplash: false,
      setupWizard: false,
      checkUpdate: false,
    },
    marketplace: { autoUpdate: "off" },
    dev: {
      autoqa: false,
      autoqaConsent: "denied",
      autoqaPush: { endpoint: "" },
    },
    memory: { backend: "off" },
    memories: { enabled: false },
    compaction: { remoteEnabled: false },
  };
}

export function buildOmpModelsConfig(
  modelSpecs: readonly ZroModel[],
): Record<string, unknown> {
  return {
    providers: {
      [PROVIDER_ID]: {
        baseUrl: BASE_URL,
        apiKey: ZRO_ENV_KEY,
        api: "openai-completions",
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          maxTokensField: "max_tokens",
        },
        models: modelSpecs.map((model) => ({
          id: model.id,
          name: model.displayName,
          reasoning: true,
          thinking: buildOmpThinkingConfig(model),
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: model.contextWindow,
          maxTokens: model.maxOutputTokens,
          compat: buildOmpModelCompat(model),
        })),
      },
    },
  };
}

function buildOmpThinkingConfig(model: ZroModel): Record<string, unknown> {
  const efforts = new Set(
    model.reasoning.levels
      .filter((level) => level.piLevel !== "off")
      .map(ompThinkingLevel),
  );
  if (ompOffFallback(model)) efforts.add(OMP_OFF_FALLBACK_LEVEL);
  const orderedEfforts = [...OMP_THINKING_LEVELS].filter((level) => efforts.has(level));
  const defaultLevel = defaultThinkingLevel(model) ?? orderedEfforts[0];
  return {
    mode: "effort",
    efforts: orderedEfforts,
    ...(defaultLevel ? { defaultLevel } : {}),
  };
}

function buildOmpModelCompat(model: ZroModel): Record<string, unknown> {
  const reasoningEffortMap = Object.fromEntries(
    model.reasoning.levels
      .filter((level) => level.piLevel !== "off")
      .map((level) => [ompThinkingLevel(level), level.id]),
  );
  const offFallback = ompOffFallback(model);
  if (offFallback) reasoningEffortMap[OMP_OFF_FALLBACK_LEVEL] = offFallback.id;

  return {
    reasoningEffortMap,
    ...(OMP_ZAI_THINKING_FORMAT_MODELS.has(model.id) ? { thinkingFormat: "zai" } : {}),
  };
}

function ompOffFallback(
  model: ZroModel,
): ZroModel["reasoning"]["levels"][number] | undefined {
  if (OMP_ZAI_THINKING_FORMAT_MODELS.has(model.id)) return undefined;
  const offLevel = model.reasoning.levels.find((level) => level.piLevel === "off");
  if (!offLevel) return undefined;
  const conflictsWithRealLevel = model.reasoning.levels.some(
    (level) => level.piLevel !== "off" && ompThinkingLevel(level) === OMP_OFF_FALLBACK_LEVEL,
  );
  return conflictsWithRealLevel ? undefined : offLevel;
}

function defaultThinkingLevel(model: ZroModel): string | undefined {
  const configured = model.reasoning.levels.find(
    (level) => level.id === model.reasoning.defaultLevel,
  );
  if (configured && configured.piLevel !== "off") return ompThinkingLevel(configured);
  const fallback = model.reasoning.levels.find((level) => level.piLevel !== "off");
  return fallback ? ompThinkingLevel(fallback) : undefined;
}

function ompThinkingLevel(level: ZroModel["reasoning"]["levels"][number]): string {
  return OMP_THINKING_LEVELS.has(level.id) ? level.id : level.piLevel;
}

function buildOmpMcpConfig(): Record<string, unknown> {
  return {
    $schema: OMP_MCP_SCHEMA,
    mcpServers: {
      [PROVIDER_ID]: {
        type: "http",
        url: MCP_URL,
        headers: { Authorization: OMP_MCP_AUTH_ENV_KEY },
        enabled: true,
      },
    },
  };
}

function resolveUserAgentDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  if (env.PI_CODING_AGENT_DIR) return path.resolve(env.PI_CODING_AGENT_DIR);
  const rootName = env.PI_CONFIG_DIR || OMP_CONFIG_DIR;
  return path.join(homeDir, rootName, "agent");
}

async function readUserConfig(agentDir: string): Promise<Record<string, unknown>> {
  const legacy = await readOptionalFile(path.join(agentDir, "settings.json"));
  const yaml = await readOptionalFile(path.join(agentDir, "config.yml"));
  const yamlAlternative = await readOptionalFile(path.join(agentDir, "config.yaml"));
  let config: Record<string, unknown> = {};
  if (legacy !== undefined) config = mergeConfig(config, json5Serializer.parse(legacy) as Record<string, unknown>);
  if (yamlAlternative !== undefined) config = mergeConfig(config, yamlSerializer.parse(yamlAlternative) as Record<string, unknown>);
  if (yaml !== undefined) config = mergeConfig(config, yamlSerializer.parse(yaml) as Record<string, unknown>);
  return config;
}

function sanitizeOmpConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_CONFIG_KEYS) {
    if (Object.hasOwn(config, key)) safe[key] = config[key];
  }
  return safe;
}

function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isPlainObject(baseValue) && isPlainObject(value)
      ? mergeConfig(baseValue, value)
      : value;
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function collectSafeUserAssets(srcRoot: string, destRoot: string): Promise<LaunchFile[]> {
  const files: LaunchFile[] = [];
  const entries = await readOptionalDirectory(srcRoot);
  if (!entries) return files;

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!SAFE_ASSET_NAMES.has(entry.name)) continue;
    await collectSafePath(path.join(srcRoot, entry.name), path.join(destRoot, entry.name), files);
  }
  return files;
}

async function collectSafePath(
  srcPath: string,
  destPath: string,
  files: LaunchFile[],
): Promise<void> {
  const stats = await readOptionalStats(srcPath);
  if (!stats || stats.isSymbolicLink()) return;
  const name = path.basename(srcPath);
  if (isSkippedAssetName(name)) return;
  if (stats.isFile()) {
    files.push({ path: destPath, contents: await fs.readFile(srcPath) });
    return;
  }
  if (!stats.isDirectory()) return;

  const entries = await fs.readdir(srcPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    await collectSafePath(path.join(srcPath, entry.name), path.join(destPath, entry.name), files);
  }
}

function isSkippedAssetName(name: string): boolean {
  return SKIPPED_ASSET_NAMES.has(name) || name.startsWith(".env");
}

async function readOptionalDirectory(directory: string): Promise<Dirent[] | undefined> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
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

async function readOptionalStats(filePath: string): Promise<Stats | undefined> {
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
