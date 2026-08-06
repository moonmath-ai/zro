import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, PROVIDER_NAME, ZRO_ENV_KEY, ZRO_MODELS, type ZroModel } from "../constants.js";
import { readConfig } from "../files.js";
import { jsonSerializer } from "../serializers.js";
import type { ToolModule } from "../types.js";
import { asPlainObject, objectAt } from "./helpers.js";

const PRIME_AGENT_DIR_ENV_KEY = "PRIME_AGENT_CODING_AGENT_DIR";
const PRIME_MCP_EXTENSION = "npm:pi-mcp-extension@1.5.0";
const PRIME_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const PRIME_SUBCOMMANDS = new Set([
  "agents", "attach", "config", "doctor", "help", "list", "model",
  "rename", "schedule", "send", "session", "shutdown", "status", "stop", "update"
]);

function primeArgs(model: string, extraArgs: string[]): string[] {
  if (extraArgs[0] && PRIME_SUBCOMMANDS.has(extraArgs[0])) {
    return extraArgs;
  }
  return ["--provider", PROVIDER_ID, "--model", model, "--extension", PRIME_MCP_EXTENSION, ...extraArgs];
}

export const primeTool: ToolModule = {
  id: "prime",
  label: "Prime Agent",
  async launch(ctx) {
    const tempHome = path.join(ctx.tempDir, "prime", "home");
    const tempAgentDir = path.join(tempHome, ".prime", "agent");
    const filePath = path.join(tempAgentDir, "models.json");
    const mcpConfigPath = path.join(tempAgentDir, "mcp.json");
    const existingAgentDir = process.env[PRIME_AGENT_DIR_ENV_KEY] ?? path.join(ctx.homeDir, ".prime", "agent");
    const existing = await readConfig(path.join(existingAgentDir, "models.json"), jsonSerializer);
    const nextConfig = buildPrimeModelsConfig(existing, ZRO_MODELS);
    return {
      tool: "prime",
      label: "Prime Agent",
      model: ctx.model,
      command: "prime-agent",
      args: primeArgs(ctx.model, ctx.extraArgs),
      env: {
        HOME: tempHome,
        [PRIME_AGENT_DIR_ENV_KEY]: tempAgentDir,
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
      message: "Launch Prime Agent with Zro"
    };
  }
};

function buildPrimeModelsConfig(
  existing: Record<string, unknown>,
  modelSpecs: readonly ZroModel[]
): Record<string, unknown> {
  const next = { ...existing };
  const providers = objectAt(next, "providers");
  const existingProvider = asPlainObject(providers[PROVIDER_ID]) ?? {};
  const providerModels = Array.isArray(existingProvider.models) ? [...existingProvider.models] : [];
  for (const zroModel of modelSpecs) {
    upsertPrimeModel(providerModels, zroModel);
  }

  providers[PROVIDER_ID] = {
    ...existingProvider,
    baseUrl: BASE_URL,
    api: "openai-completions",
    apiKey: ZRO_ENV_KEY,
    headers: {
      ...(asPlainObject(existingProvider.headers) ?? {}),
      "User-Agent": "prime-agent"
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

function upsertPrimeModel(models: unknown[], model: ZroModel): void {
  const nextModel = {
    id: model.id,
    name: model.displayName,
    reasoning: true,
    thinkingLevelMap: buildPrimeThinkingLevelMap(model),
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

function buildPrimeThinkingLevelMap(model: ZroModel): Record<string, string | null> {
  const result = Object.fromEntries(
    PRIME_THINKING_LEVELS.map((level) => [level, null])
  ) as Record<string, string | null>;

  for (const level of model.reasoning.levels) {
    result[level.piLevel] = level.id;
  }

  return result;
}
