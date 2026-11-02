import path from "node:path";
import YAML from "yaml";
import {
  BASE_URL,
  MCP_URL,
  PROVIDER_ID,
  PROVIDER_NAME,
  ZRO_ENV_KEY,
  type ZroModel,
} from "../constants.js";
import type { ToolModule } from "../types.js";

const DSH_MCP_SERVER_NAME = PROVIDER_ID;
const DSH_INPUT_MODALITIES = new Set(["text", "image"]);

export const dshTool: ToolModule = {
  id: "dsh",
  label: "DeepSeek Harness",
  async launch(ctx) {
    const dshHome = path.join(ctx.tempDir, "dsh");
    const patchPath = path.join(dshHome, "profiles", "web", "cordis.patch.yml");
    return {
      tool: "dsh",
      label: "DeepSeek Harness",
      model: ctx.model,
      command: "dsh",
      args: ["web", ...ctx.extraArgs],
      env: {
        DSH_HOME: dshHome,
        [ZRO_ENV_KEY]: ctx.apiKey,
        DO_NOT_TRACK: "1"
      },
      files: [
        {
          path: patchPath,
          contents: buildDshPatch(ctx.model, ctx.models, {
            baseUrl: ctx.inferenceBaseUrl,
            mcpUrl: ctx.mcpUrl,
            noAuth: ctx.noAuth
          })
        }
      ],
      message: "Launch DeepSeek Harness with Zro"
    };
  }
};

export function buildDshPatch(
  model: string,
  modelSpecs: readonly ZroModel[],
  options: { baseUrl?: string; mcpUrl?: string; noAuth?: boolean } = {}
): string {
  const entries: unknown[] = [
    {
      id: "agent-default-model",
      config: {
        provider: PROVIDER_ID,
        model
      }
    },
    {
      id: "llm-pi-ai",
      config: {
        providers: {
          [PROVIDER_ID]: {
            displayName: PROVIDER_NAME,
            apiKeyEnv: ZRO_ENV_KEY,
            api: "openai-completions",
            baseURL: options.baseUrl ?? BASE_URL,
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: modelSpecs.some((model) => model.reasoning.levels.length > 0),
              maxTokensField: "max_tokens"
            },
            models: modelSpecs.map(dshModel)
          }
        }
      }
    }
  ];

  if (!options.noAuth) {
    const authorization = new YAML.Scalar(`"Bearer " + process.env.${ZRO_ENV_KEY}`);
    authorization.tag = "!!js";
    entries.push({
      insert: [
        {
          id: `${PROVIDER_ID}-mcp`,
          name: "@deepseek-ai/dsh-mcp-client",
          config: {
            transport: "streamable-http",
            serverName: DSH_MCP_SERVER_NAME,
            url: options.mcpUrl ?? MCP_URL,
            headers: { Authorization: authorization }
          }
        }
      ]
    });
  }

  return new YAML.Document(entries).toString({ lineWidth: 0 });
}

function dshModel(model: ZroModel): Record<string, unknown> {
  const input = model.modalities.input.filter((modality) => DSH_INPUT_MODALITIES.has(modality));
  const reasoningEfforts = Object.fromEntries(
    model.reasoning.levels.map((level) => [level.piLevel, level.id])
  );

  return {
    id: model.id,
    name: model.displayName,
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens,
    input: input.length ? input : ["text"],
    ...(model.reasoning.levels.length ? { reasoningEfforts } : { reasoningEfforts: false })
  };
}
