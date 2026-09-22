import path from "node:path";
import { ENDPOINT_ROOT, MCP_URL, PROVIDER_NAME, type ZroModel } from "../constants.js";
import { jsonSerializer } from "../serializers.js";
import type { ToolModule } from "../types.js";

export const claudeTool: ToolModule = {
  id: "claude",
  label: "Claude Code",
  async launch(ctx) {
    const mcpConfigPath = path.join(ctx.tempDir, "claude", "mcp.json");
    return {
      tool: "claude",
      label: "Claude Code",
      model: ctx.model,
      command: "claude",
      args: [
        "--model",
        claudeModelId(ctx.model, ctx.models),
        "--managed-settings",
        buildClaudeManagedSettingsArg(ctx.models),
        "--mcp-config",
        mcpConfigPath,
        ...ctx.extraArgs
      ],
      env: {
        ANTHROPIC_BASE_URL: ENDPOINT_ROOT,
        ANTHROPIC_AUTH_TOKEN: ctx.apiKey,
        ...buildClaudeModelEnv(ctx.model, ctx.models, ctx.modelAliases),
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "0",
        CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
        CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE: "0",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1",
        DISABLE_FEEDBACK_COMMAND: "1",
        CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
        DO_NOT_TRACK: "1"
      },
      files: [{
        path: mcpConfigPath,
        contents: jsonSerializer.stringify({
          mcpServers: {
            zro: {
              type: "http",
              url: MCP_URL,
              headers: { Authorization: `Bearer ${ctx.apiKey}` }
            }
          }
        })
      }],
      message: "Launch Claude Code with Zro"
    };
  }
};

// Claude Code's tier aliases (opus/sonnet/fable/haiku) must resolve to Zro
// models, or internal alias usage would fall through to real Anthropic model
// names the Zro endpoint cannot serve. Derived from the active catalog so new
// models need no code changes; users can override per slot with --alias.
export const CLAUDE_MODEL_ALIAS_SLOTS = ["OPUS", "SONNET", "FABLE", "HAIKU"] as const;

function buildClaudeManagedSettingsArg(modelSpecs: readonly ZroModel[]): string {
  return JSON.stringify({
    availableModels: modelSpecs.map((model) => model.id),
    enforceAvailableModels: true,
    permissions: {
      deny: ["WebSearch"]
    }
  });
}

const ONE_MILLION = 1048576;

function buildClaudeModelEnv(
  selectedModel: string,
  modelSpecs: readonly ZroModel[],
  modelAliases: Readonly<Record<string, string>> = {}
): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_CUSTOM_MODEL_OPTION: claudeModelId(selectedModel, modelSpecs),
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: claudeModelName(selectedModel, modelSpecs),
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: `${PROVIDER_NAME} model via ${ENDPOINT_ROOT}`
  };

  const selectedSpec = modelSpecs.find((m) => m.id === selectedModel);
  if (selectedSpec) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(selectedSpec.contextWindow);
  }

  // Tier-map the remaining models into the alias slots by output capacity:
  // opus gets the beefiest, haiku (used for cheap background tasks) the smallest.
  const aliasMapping: Record<string, string> = {};
  const otherModels = modelSpecs
    .filter((model) => model.id !== selectedModel)
    .sort((a, b) => b.maxOutputTokens - a.maxOutputTokens)
    .map((model) => model.id);
  for (const [index, modelId] of otherModels.entries()) {
    if (index >= CLAUDE_MODEL_ALIAS_SLOTS.length) break;
    aliasMapping[CLAUDE_MODEL_ALIAS_SLOTS[index]] = modelId;
  }
  for (const [slot, modelId] of Object.entries(modelAliases)) {
    if (modelId) aliasMapping[slot] = modelId;
    else delete aliasMapping[slot];
  }

  for (const [slot, modelId] of Object.entries(aliasMapping)) {
    if (!modelSpecs.some((model) => model.id === modelId)) continue;
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL`] = claudeModelId(modelId, modelSpecs);
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_NAME`] = claudeModelName(modelId, modelSpecs);
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_DESCRIPTION`] = `${PROVIDER_NAME} model via ${ENDPOINT_ROOT}`;
  }

  return env;
}

function claudeModelId(modelId: string, modelSpecs: readonly ZroModel[]): string {
  const spec = modelSpecs.find((m) => m.id === modelId);
  if (spec && spec.contextWindow >= ONE_MILLION) {
    return `${modelId}[1m]`;
  }
  return modelId;
}

function claudeModelName(modelId: string, modelSpecs: readonly ZroModel[]): string {
  const displayName = modelSpecs.find((model) => model.id === modelId)?.displayName ?? modelId;
  return `${PROVIDER_NAME} ${displayName}`;
}
