import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, ZRO_ENV_KEY, ZRO_MODELS, type ZroModel } from "../constants.js";
import { readConfig } from "../files.js";
import { json5Serializer } from "../serializers.js";
import type { ToolModule } from "../types.js";
import { asPlainObject, objectAt } from "./helpers.js";

const OPENCLAW_API = "openai-responses";

export const openClawTool: ToolModule = {
  id: "openclaw",
  label: "OpenClaw",
  async launch(ctx) {
    const tempHome = path.join(ctx.tempDir, "home");
    const filePath = path.join(tempHome, ".openclaw", "openclaw.json");
    const existing = await readConfig(path.join(ctx.homeDir, ".openclaw", "openclaw.json"), json5Serializer);
    const nextConfig = buildOpenClawConfig(existing, ctx.apiKey, ZRO_MODELS);
    objectAt(objectAt(objectAt(nextConfig, "agents"), "defaults"), "model").primary = `${PROVIDER_ID}/${ctx.model}`;
    return {
      tool: "openclaw",
      label: "OpenClaw",
      model: ctx.model,
      command: "openclaw",
      args: buildOpenClawArgs(ctx.extraArgs),
      env: {
        HOME: tempHome,
        [ZRO_ENV_KEY]: ctx.apiKey
      },
      files: [{
        path: filePath,
        contents: json5Serializer.stringify(nextConfig)
      }],
      message: "Launch OpenClaw with Zro"
    };
  }
};

function buildOpenClawArgs(extraArgs: string[]): string[] {
  if (extraArgs.length === 0) {
    return ["chat"];
  }

  const [command, ...rest] = extraArgs;
  if ((command === "tui" || command === "terminal") && !rest.includes("--local")) {
    return [command, "--local", ...rest];
  }

  return extraArgs;
}

function buildOpenClawConfig(
  existing: Record<string, unknown>,
  apiKey: string,
  modelSpecs: readonly ZroModel[]
): Record<string, unknown> {
  const next = { ...existing };

  const agents = objectAt(next, "agents");
  const defaults = objectAt(agents, "defaults");

  const allowedModels = objectAt(defaults, "models");
  for (const zroModel of modelSpecs) {
    const modelRef = `${PROVIDER_ID}/${zroModel.id}`;
    const existingAlias = allowedModels[modelRef];
    allowedModels[modelRef] = {
      ...(asPlainObject(existingAlias) ?? {}),
      alias: zroModel.id
    };
  }

  const modelsRoot = objectAt(next, "models");
  if (typeof modelsRoot.mode !== "string") {
    modelsRoot.mode = "merge";
  }

  const providers = objectAt(modelsRoot, "providers");
  const provider = { ...(asPlainObject(providers[PROVIDER_ID]) ?? {}) };

  const providerModels = Array.isArray(provider.models) ? [...provider.models] : [];
  for (const zroModel of modelSpecs) {
    upsertOpenClawModel(providerModels, zroModel);
  }

  providers[PROVIDER_ID] = {
    ...provider,
    baseUrl: BASE_URL,
    apiKey,
    api: OPENCLAW_API,
    timeoutSeconds: typeof provider.timeoutSeconds === "number" ? provider.timeoutSeconds : 300,
    models: providerModels
  };

  const mcpServers = objectAt(objectAt(next, "mcp"), "servers");
  const existingMcpServer = asPlainObject(mcpServers[PROVIDER_ID]) ?? {};
  mcpServers[PROVIDER_ID] = {
    ...existingMcpServer,
    url: MCP_URL,
    transport: "streamable-http",
    enabled: true,
    headers: {
      ...(asPlainObject(existingMcpServer.headers) ?? {}),
      Authorization: `Bearer \${${ZRO_ENV_KEY}}`
    },
    toolFilter: {
      include: ["zro-web_search"]
    }
  };

  return next;
}

function upsertOpenClawModel(models: unknown[], model: ZroModel): void {
  const index = models.findIndex((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return (entry as Record<string, unknown>).id === model.id;
  });
  const existingModel = index >= 0 ? asPlainObject(models[index]) ?? {} : {};
  const existingCompat = asPlainObject(existingModel.compat) ?? {};
  const existingHeaders = asPlainObject(existingModel.headers) ?? {};
  const thinkingLevelMap = buildOpenClawThinkingLevelMap(model);
  const supportedReasoningEfforts = [...new Set(Object.values(thinkingLevelMap))];
  if (thinkingLevelMap.xhigh !== thinkingLevelMap.high) {
    supportedReasoningEfforts.push("xhigh");
  }
  const nextModel = {
    id: model.id,
    name: model.id,
    api: OPENCLAW_API,
    reasoning: true,
    thinkingLevelMap,
    headers: {
      ...existingHeaders,
      "User-Agent": "openclaw"
    },
    input: ["text"],
    compat: {
      ...existingCompat,
      supportsReasoningEffort: true,
      supportedReasoningEfforts,
      reasoningEffortMap: thinkingLevelMap,
      supportsPromptCacheKey: true
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens
  };

  if (index >= 0) {
    models[index] = { ...existingModel, ...nextModel };
    return;
  }

  models.unshift(nextModel);
}

function buildOpenClawThinkingLevelMap(model: ZroModel): Record<string, string> {
  const nativeByLevel = Object.fromEntries(
    model.reasoning.levels.map((level) => [level.piLevel, level.id])
  ) as Record<string, string>;
  const defaultEffort = model.reasoning.defaultLevel;
  const firstEnabled = nativeByLevel.minimal
    ?? nativeByLevel.low
    ?? nativeByLevel.medium
    ?? nativeByLevel.high
    ?? nativeByLevel.xhigh
    ?? defaultEffort;

  return {
    off: nativeByLevel.off ?? defaultEffort,
    minimal: nativeByLevel.minimal ?? nativeByLevel.low ?? nativeByLevel.medium ?? firstEnabled,
    low: nativeByLevel.low ?? nativeByLevel.medium ?? firstEnabled,
    medium: nativeByLevel.medium ?? nativeByLevel.high ?? firstEnabled,
    high: nativeByLevel.high ?? nativeByLevel.xhigh ?? firstEnabled,
    xhigh: nativeByLevel.xhigh ?? nativeByLevel.high ?? firstEnabled,
    max: nativeByLevel.xhigh ?? nativeByLevel.high ?? firstEnabled
  };
}
