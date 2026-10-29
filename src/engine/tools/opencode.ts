import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, PROVIDER_NAME, ZRO_ENV_KEY, supportsAttachments, type ZroModel } from "../constants.js";
import { jsonSerializer } from "../serializers.js";
import type { ToolModule } from "../types.js";
import { asPlainObject, objectAt } from "./helpers.js";
import { collectUserConfigFiles, readOpenCodeConfig } from "./opencode-shared.js";

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
    const nextConfig = buildOpenCodeConfig(existing, ctx.apiKey, ctx.models, true, {
      baseUrl: ctx.inferenceBaseUrl,
      mcpUrl: ctx.mcpUrl,
      noAuth: ctx.noAuth,
    });
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

export function buildOpenCodeConfig(
  existing: Record<string, unknown>,
  apiKey: string,
  modelSpecs: readonly ZroModel[],
  useEnvReference = false,
  endpoints: { baseUrl?: string; mcpUrl?: string; noAuth?: boolean } = {},
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
    useEnvReference,
    endpoints.baseUrl
  );
  if (endpoints.noAuth) {
    const mcp = asPlainObject(next.mcp);
    if (mcp) delete mcp[PROVIDER_ID];
  } else {
    const mcp = objectAt(next, "mcp");
    mcp[PROVIDER_ID] = {
      type: "remote",
      url: endpoints.mcpUrl ?? MCP_URL,
      enabled: true,
      oauth: false,
      headers: {
        Authorization: `Bearer {env:${ZRO_ENV_KEY}}`
      }
    };
  }
  return next;
}

function openAiCompatibleProvider(
  existing: unknown,
  apiKey: string,
  modelSpecs: readonly ZroModel[],
  useEnvReference = false,
  baseUrl = BASE_URL,
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
      attachment: supportsAttachments(model),
      modalities: { input: model.modalities.input, output: model.modalities.output },
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
      baseURL: baseUrl,
      apiKey: useEnvReference ? `{env:${ZRO_ENV_KEY}}` : apiKey
    },
    models
  };
}
