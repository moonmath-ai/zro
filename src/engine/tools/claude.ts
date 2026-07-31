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
        ctx.model,
        "--managed-settings",
        buildClaudeManagedSettingsArg(ctx.models),
        "--mcp-config",
        mcpConfigPath,
        ...ctx.extraArgs
      ],
      env: {
        ANTHROPIC_BASE_URL: ENDPOINT_ROOT,
        ANTHROPIC_AUTH_TOKEN: ctx.apiKey,
        ...buildClaudeModelEnv(ctx.model, ctx.models),
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

const CLAUDE_MODEL_ALIAS_SLOTS = ["SONNET", "FABLE", "HAIKU"] as const;

function buildClaudeManagedSettingsArg(modelSpecs: readonly ZroModel[]): string {
  return JSON.stringify({
    availableModels: modelSpecs.map((model) => model.id),
    enforceAvailableModels: true,
    permissions: {
      deny: ["WebSearch"]
    }
  });
}

function buildClaudeModelEnv(
  selectedModel: string,
  modelSpecs: readonly ZroModel[]
): Record<string, string> {
  const otherModels = modelSpecs
    .map((model) => model.id)
    .filter((modelId) => modelId !== selectedModel);
  const env: Record<string, string> = {
    ANTHROPIC_CUSTOM_MODEL_OPTION: selectedModel,
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: claudeModelName(selectedModel, modelSpecs),
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: `${PROVIDER_NAME} model via ${ENDPOINT_ROOT}`
  };

  for (const [index, modelId] of otherModels.slice(0, CLAUDE_MODEL_ALIAS_SLOTS.length).entries()) {
    const slot = CLAUDE_MODEL_ALIAS_SLOTS[index];
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL`] = modelId;
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_NAME`] = claudeModelName(modelId, modelSpecs);
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_DESCRIPTION`] = `${PROVIDER_NAME} model via ${ENDPOINT_ROOT}`;
  }

  return env;
}

function claudeModelName(modelId: string, modelSpecs: readonly ZroModel[]): string {
  const displayName = modelSpecs.find((model) => model.id === modelId)?.displayName ?? modelId;
  return `${PROVIDER_NAME} ${displayName}`;
}
