import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, ZRO_ENV_KEY, type ZroModel } from "../constants.js";
import { readConfig } from "../files.js";
import { yamlSerializer } from "../serializers.js";
import type { ApiKeySource, ToolModule } from "../types.js";
import { asPlainObject } from "./helpers.js";

export const hermesTool: ToolModule = {
  id: "hermes",
  label: "Hermes",
  async launch(ctx) {
    const tempHome = path.join(ctx.tempDir, "home");
    const filePath = path.join(tempHome, ".hermes", "config.yaml");
    const existing = await readConfig(path.join(ctx.homeDir, ".hermes", "config.yaml"), yamlSerializer);
    const nextConfig = buildHermesConfig(existing, ctx.apiKey, ctx.apiKeySource, ctx.models);
    return {
      tool: "hermes",
      label: "Hermes",
      model: ctx.model,
      command: "hermes",
      args: ["--provider", PROVIDER_ID, "--model", ctx.model, ...ctx.extraArgs],
      env: {
        HOME: tempHome,
        [ZRO_ENV_KEY]: ctx.apiKey
      },
      files: [{
        path: filePath,
        contents: yamlSerializer.stringify(nextConfig)
      }],
      message: "Launch Hermes with Zro"
    };
  }
};

function buildHermesConfig(
  existing: Record<string, unknown>,
  apiKey: string,
  apiKeySource: ApiKeySource,
  modelSpecs: readonly ZroModel[]
): Record<string, unknown> {
  const next = { ...existing };
  const providers = Array.isArray(next.custom_providers) ? [...next.custom_providers] : [];
  const providerIndex = providers.findIndex((entry) => asPlainObject(entry)?.name === PROVIDER_ID);
  const existingProvider = providerIndex >= 0 ? asPlainObject(providers[providerIndex]) ?? {} : {};
  const models = { ...(asPlainObject(existingProvider.models) ?? {}) };
  for (const model of modelSpecs) {
    models[model.id] = {
      ...(asPlainObject(models[model.id]) ?? {}),
      context_length: model.contextWindow
    };
  }

  const provider: Record<string, unknown> = {
    ...existingProvider,
    name: PROVIDER_ID,
    base_url: BASE_URL,
    api_mode: "chat_completions",
    models
  };

  if (apiKeySource === "env") {
    delete provider.api_key;
    provider.key_env = ZRO_ENV_KEY;
  } else {
    delete provider.key_env;
    provider.api_key = apiKey;
  }

  if (providerIndex >= 0) {
    providers[providerIndex] = provider;
  } else {
    providers.push(provider);
  }

  const mcpServers = { ...(asPlainObject(next.mcp_servers) ?? {}) };
  const existingMcpServer = { ...(asPlainObject(mcpServers[PROVIDER_ID]) ?? {}) };
  const existingTools = { ...(asPlainObject(existingMcpServer.tools) ?? {}) };
  delete existingTools.include;
  mcpServers[PROVIDER_ID] = {
    ...existingMcpServer,
    url: MCP_URL,
    enabled: true,
    headers: {
      ...(asPlainObject(existingMcpServer.headers) ?? {}),
      Authorization: `Bearer \${${ZRO_ENV_KEY}}`
    },
    tools: {
      ...existingTools,
      resources: false,
      prompts: false
    }
  };
  next.mcp_servers = mcpServers;

  const existingModelConfig = asPlainObject(next.model) ?? {};
  next.model = {
    ...existingModelConfig,
    default_headers: {
      ...(asPlainObject(existingModelConfig.default_headers) ?? {}),
      "User-Agent": "hermes"
    }
  };
  next.custom_providers = providers;
  return next;
}
