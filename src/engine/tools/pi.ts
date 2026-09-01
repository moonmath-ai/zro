import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, PROVIDER_NAME, ZRO_ENV_KEY, type ZroModel } from "../constants.js";
import { readConfig } from "../files.js";
import { jsonSerializer } from "../serializers.js";
import type { ToolModule } from "../types.js";
import { asPlainObject, objectAt } from "./helpers.js";

const PI_AGENT_DIR_ENV_KEY = "PI_CODING_AGENT_DIR";
const PI_MCP_EXTENSION = "npm:pi-mcp-extension@1.5.0";
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export const piTool: ToolModule = {
  id: "pi",
  label: "Pi",
  async launch(ctx) {
    const tempHome = path.join(ctx.tempDir, "pi", "home");
    const tempAgentDir = path.join(tempHome, ".pi", "agent");
    const filePath = path.join(tempAgentDir, "models.json");
    const mcpConfigPath = path.join(tempAgentDir, "mcp.json");
    const existingAgentDir = process.env[PI_AGENT_DIR_ENV_KEY] ?? path.join(ctx.homeDir, ".pi", "agent");
    const existing = await readConfig(path.join(existingAgentDir, "models.json"), jsonSerializer);
    const nextConfig = buildPiModelsConfig(existing, ctx.models);
    return {
      tool: "pi",
      label: "Pi",
      model: ctx.model,
      command: "pi",
      args: [
        "--provider", PROVIDER_ID,
        "--model", ctx.model,
        "--extension", PI_MCP_EXTENSION,
        ...ctx.extraArgs
      ],
      env: {
        HOME: tempHome,
        [PI_AGENT_DIR_ENV_KEY]: tempAgentDir,
        [ZRO_ENV_KEY]: ctx.apiKey
      },
      files: [
        {
          path: filePath,
          contents: jsonSerializer.stringify(nextConfig)
        },
        {
          path: mcpConfigPath,
          contents: jsonSerializer.stringify({
            mcpServers: {
              zro: {
                transport: "streamable-http",
                url: MCP_URL,
                lifecycle: "eager",
                headers: { Authorization: `Bearer ${ctx.apiKey}` }
              }
            }
          })
        }
      ],
      message: "Launch Pi with Zro"
    };
  }
};

function buildPiModelsConfig(
  existing: Record<string, unknown>,
  modelSpecs: readonly ZroModel[]
): Record<string, unknown> {
  const next = { ...existing };
  const providers = objectAt(next, "providers");
  const existingProvider = asPlainObject(providers[PROVIDER_ID]) ?? {};
  const providerModels = Array.isArray(existingProvider.models) ? [...existingProvider.models] : [];
  for (const zroModel of modelSpecs) {
    upsertPiModel(providerModels, zroModel);
  }

  providers[PROVIDER_ID] = {
    ...existingProvider,
    baseUrl: BASE_URL,
    api: "openai-completions",
    apiKey: `$${ZRO_ENV_KEY}`,
    headers: {
      ...(asPlainObject(existingProvider.headers) ?? {}),
      "User-Agent": "pi-coding-agent"
    },
    compat: {
      ...(asPlainObject(existingProvider.compat) ?? {}),
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens"
    },
    models: providerModels
  };

  return next;
}

function upsertPiModel(models: unknown[], model: ZroModel): void {
  const nextModel = {
    id: model.id,
    name: model.displayName,
    reasoning: true,
    thinkingLevelMap: buildPiThinkingLevelMap(model),
    input: ["text"],
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens
  };

  const index = models.findIndex((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return (entry as Record<string, unknown>).id === model.id;
  });

  if (index >= 0) {
    models[index] = { ...(models[index] as Record<string, unknown>), ...nextModel };
    return;
  }

  models.push(nextModel);
}

function buildPiThinkingLevelMap(model: ZroModel): Record<string, string | null> {
  const result = Object.fromEntries(
    PI_THINKING_LEVELS.map((level) => [level, null])
  ) as Record<string, string | null>;

  for (const level of model.reasoning.levels) {
    result[level.piLevel] = level.id;
  }

  return result;
}
