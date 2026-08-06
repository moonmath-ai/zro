import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, PROVIDER_NAME, ZRO_ENV_KEY, type ZroModel } from "../constants.js";
import type { ToolModule } from "../types.js";

const GROK_HOME_ENV_KEY = "GROK_HOME";

export const grokTool: ToolModule = {
  id: "grok",
  label: "Grok Build",
  async launch(ctx) {
    const grokHome = path.join(ctx.tempDir, "grok-home");
    const configPath = path.join(grokHome, "config.toml");
    return {
      tool: "grok",
      label: "Grok Build",
      model: ctx.model,
      command: "grok",
      args: ["-m", ctx.model, ...ctx.extraArgs],
      env: {
        [GROK_HOME_ENV_KEY]: grokHome,
        [ZRO_ENV_KEY]: ctx.apiKey
      },
      files: [{
        path: configPath,
        contents: buildGrokConfig(ctx.model, ctx.apiKey, ctx.models)
      }],
      message: "Launch Grok Build with Zro"
    };
  }
};

function buildGrokConfig(
  selectedModel: string,
  apiKey: string,
  modelSpecs: readonly ZroModel[],
): string {
  const lines: string[] = [];

  lines.push("[models]");
  lines.push(`default = ${tomlString(selectedModel)}`);
  lines.push("");

  lines.push("[cli]");
  lines.push("auto_update = false");
  lines.push("");

  lines.push("[features]");
  lines.push("telemetry = false");
  lines.push("");

  for (const model of modelSpecs) {
    lines.push(`[model.${tomlKey(model.id)}]`);
    lines.push(`model = ${tomlString(model.id)}`);
    lines.push(`base_url = ${tomlString(BASE_URL)}`);
    lines.push(`name = ${tomlString(`${PROVIDER_NAME} ${model.displayName}`)}`);
    lines.push(`description = ${tomlString(`${PROVIDER_NAME} model via ${BASE_URL}`)}`);
    lines.push(`api_backend = "chat_completions"`);
    lines.push(`env_key = ${tomlString(ZRO_ENV_KEY)}`);
    lines.push(`context_window = ${model.contextWindow}`);
    lines.push(`max_completion_tokens = ${model.maxOutputTokens}`);
    lines.push(`stream_tool_calls = false`);
    lines.push("");
  }

  lines.push(`[mcp_servers.${PROVIDER_ID}]`);
  lines.push(`url = ${tomlString(MCP_URL)}`);
  lines.push(`headers = { "Authorization" = ${tomlString(`Bearer ${apiKey}`)} }`);
  lines.push("");

  return lines.join("\n");
}

function tomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
