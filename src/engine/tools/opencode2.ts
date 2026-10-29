import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, PROVIDER_NAME, ZRO_ENV_KEY, type ZroModel } from "../constants.js";
import { jsonSerializer } from "../serializers.js";
import type { ToolModule } from "../types.js";
import { asPlainObject, objectAt } from "./helpers.js";
import { collectUserConfigFiles, readOpenCodeConfig } from "./opencode-shared.js";

export const opencode2Tool: ToolModule = {
  id: "opencode2",
  label: "OpenCode 2",
  async launch(ctx) {
    const configRoot = path.join(ctx.tempDir, "xdg");
    const opencodeRoot = path.join(configRoot, "opencode");
    const filePath = path.join(opencodeRoot, "opencode.json");
    const userConfigRoot = ctx.env.XDG_CONFIG_HOME ?? path.join(ctx.homeDir, ".config");
    const userOpencodeRoot = path.join(userConfigRoot, "opencode");
    const existing = await readOpenCodeConfig(userOpencodeRoot);
    const nextConfig = buildOpenCode2Config(existing, ctx.apiKey, ctx.models, true);
    nextConfig.model = `${PROVIDER_ID}/${ctx.model}`;
    const userFiles = await collectUserConfigFiles(userOpencodeRoot, opencodeRoot);
    const isDebug = ctx.extraArgs[0] === "debug";
    const hasServerFlag = ctx.extraArgs.includes("--standalone") || ctx.extraArgs.includes("--server");
    const args = isDebug || hasServerFlag
      ? [...ctx.extraArgs]
      : ["--standalone", ...ctx.extraArgs];

    return {
      tool: "opencode2",
      label: "OpenCode 2",
      model: ctx.model,
      command: "opencode2",
      args,
      env: {
        XDG_CONFIG_HOME: configRoot,
        [ZRO_ENV_KEY]: ctx.apiKey,
        DO_NOT_TRACK: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1"
      },
      files: [
        { path: filePath, contents: jsonSerializer.stringify(nextConfig) },
        ...userFiles
      ],
      message: "Launch OpenCode 2 with Zro"
    };
  }
};

export function buildOpenCode2Config(
  existing: Record<string, unknown>,
  apiKey: string,
  modelSpecs: readonly ZroModel[],
  useEnvReference = false
): Record<string, unknown> {
  const next = { ...existing };
  if (typeof next.$schema !== "string") {
    next.$schema = "https://opencode.ai/config.json";
  }

  const providers = objectAt(next, "providers");
  const existingProvider = asPlainObject(providers[PROVIDER_ID]) ?? {};
  const settings = asPlainObject(existingProvider.settings) ?? {};
  const models = { ...(asPlainObject(existingProvider.models) ?? {}) };
  for (const model of modelSpecs) {
    const existingModel = asPlainObject(models[model.id]) ?? {};
    models[model.id] = {
      ...existingModel,
      name: model.id,
      capabilities: {
        ...(asPlainObject(existingModel.capabilities) ?? {}),
        tools: true,
        input: [...model.modalities.input],
        output: [...model.modalities.output]
      },
      limit: {
        ...(asPlainObject(existingModel.limit) ?? {}),
        context: model.contextWindow,
        output: model.maxOutputTokens
      },
      variants: mergeVariants(existingModel.variants, model)
    };
  }

  const headers = asPlainObject(existingProvider.headers) ?? {};
  providers[PROVIDER_ID] = {
    ...existingProvider,
    name: PROVIDER_NAME,
    package: "@opencode/ai/providers/openai-compatible",
    settings: {
      ...settings,
      baseURL: BASE_URL,
      apiKey: useEnvReference ? `{env:${ZRO_ENV_KEY}}` : apiKey
    },
    ...(Object.keys(headers).length ? { headers } : {}),
    models
  };

  const legacyProvider = asPlainObject(next.provider);
  if (legacyProvider) {
    delete legacyProvider[PROVIDER_ID];
    if (Object.keys(legacyProvider).length === 0) delete next.provider;
  }

  const mcp = objectAt(next, "mcp");
  delete mcp[PROVIDER_ID];
  const servers = objectAt(mcp, "servers");
  servers[PROVIDER_ID] = {
    type: "remote",
    url: MCP_URL,
    oauth: false,
    headers: {
      Authorization: `Bearer {env:${ZRO_ENV_KEY}}`
    }
  };
  return next;
}

function mergeVariants(existing: unknown, model: ZroModel): Record<string, unknown>[] {
  const variants = Array.isArray(existing)
    ? existing
        .map((entry) => asPlainObject(entry))
        .filter((entry): entry is Record<string, unknown> => typeof entry?.id === "string")
        .map((entry) => ({ ...entry }))
    : [];
  for (const level of model.reasoning.levels) {
    const index = variants.findIndex((variant) => variant.id === level.id);
    const existingVariant = index >= 0 ? variants[index] : {};
    const next = {
      ...existingVariant,
      id: level.id,
      settings: {
        ...(asPlainObject(existingVariant.settings) ?? {}),
        ...level.openCodeOptions
      }
    };
    if (index >= 0) variants[index] = next;
    else variants.push(next);
  }
  return variants;
}
