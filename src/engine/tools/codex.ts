import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, PROVIDER_NAME, ZRO_ENV_KEY, type ZroModel } from "../constants.js";
import { jsonSerializer } from "../serializers.js";
import type { ToolModule } from "../types.js";

export const codexTool: ToolModule = {
  id: "codex",
  label: "Codex CLI",
  async launch(ctx) {
    const codexHome = path.join(ctx.tempDir, "codex");
    const catalogPath = path.join(codexHome, "zro-models.json");
    const selectedModel = ctx.models.find((model) => model.id === ctx.model);
    return {
      tool: "codex",
      label: "Codex CLI",
      model: ctx.model,
      command: "codex",
      args: codexArgs(ctx.model, ctx.extraArgs),
      env: {
        CODEX_HOME: codexHome,
        [ZRO_ENV_KEY]: ctx.apiKey
      },
      files: [
        {
          path: path.join(codexHome, "config.toml"),
          contents: buildCodexConfig(ctx.model, {
            catalogPath,
            modelSpec: selectedModel
          })
        },
        {
          path: catalogPath,
          contents: jsonSerializer.stringify(buildCodexModelCatalog(ctx.models))
        }
      ],
      message: "Launch Codex CLI with Zro"
    };
  }
};

const CODEX_SUBCOMMANDS = new Set([
  "app-server",
  "apply",
  "archive",
  "cloud",
  "completion",
  "debug",
  "delete",
  "doctor",
  "exec",
  "exec-server",
  "features",
  "fork",
  "help",
  "login",
  "logout",
  "mcp",
  "mcp-server",
  "plugin",
  "remote-control",
  "resume",
  "review",
  "sandbox",
  "unarchive",
  "update"
]);

function codexArgs(model: string, extraArgs: string[]): string[] {
  const modelOverride = ["-c", `model=${tomlString(model)}`];
  if (extraArgs[0] && CODEX_SUBCOMMANDS.has(extraArgs[0])) {
    return [extraArgs[0], ...modelOverride, ...extraArgs.slice(1)];
  }
  return [...modelOverride, ...extraArgs];
}

export const codexAppTool: ToolModule = {
  id: "codex-app",
  label: "Codex App",
  async launch(ctx) {
    const codexHome = codexAppHome(ctx.homeDir);
    const catalogPath = path.join(codexHome, "zro-models.json");
    return {
      tool: "codex-app",
      label: "Codex App",
      model: ctx.model,
      command: "codex",
      args: ["app", ...ctx.extraArgs],
      env: {
        CODEX_HOME: codexHome,
        [ZRO_ENV_KEY]: ctx.apiKey
      },
      files: [
        {
          path: path.join(codexHome, "config.toml"),
          contents: buildCodexConfig(ctx.model, { catalogPath }),
          persistent: true
        },
        {
          path: codexAppCredentialFilePath(ctx.homeDir),
          contents: `${ZRO_ENV_KEY}=${dotenvValue(ctx.apiKey)}\n`,
          persistent: true
        },
        {
          path: catalogPath,
          contents: jsonSerializer.stringify(buildCodexModelCatalog(ctx.models)),
          persistent: true
        }
      ],
      message: "Launch Codex App with Zro"
    };
  }
};

export function codexAppHome(homeDir: string): string {
  return path.join(homeDir, ".config", "zro", "codex-app");
}

export function codexAppCredentialFilePath(homeDir: string): string {
  return path.join(codexAppHome(homeDir), ".env");
}

export function buildCodexModelCatalog(modelSpecs: readonly ZroModel[]): Record<string, unknown> {
  return {
    models: modelSpecs.map((model, index) => ({
      slug: model.id,
      display_name: model.displayName,
      description: `${PROVIDER_NAME} model via ${BASE_URL}`,
      default_reasoning_level: codexReasoningEffort(
        model.reasoning.levels.find(
          (level) => level.id === model.reasoning.defaultLevel
        )
      ) ?? model.reasoning.defaultLevel,
      supported_reasoning_levels: model.reasoning.levels.map((level) => ({
        effort: codexReasoningEffort(level),
        description: level.description
      })),
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: 900 + index,
      additional_speed_tiers: [],
      service_tiers: [],
      availability_nux: null,
      upgrade: null,
      base_instructions: "",
      model_messages: {},
      supports_reasoning_summaries: true,
      default_reasoning_summary: "none",
      support_verbosity: false,
      default_verbosity: "medium",
      apply_patch_tool_type: "freeform",
      web_search_tool_type: "text_and_image",
      truncation_policy: {
        mode: "tokens",
        limit: model.contextWindow
      },
      supports_parallel_tool_calls: true,
      supports_image_detail_original: true,
      context_window: model.contextWindow,
      max_context_window: model.contextWindow,
      effective_context_window_percent: 95,
      experimental_supported_tools: [],
      input_modalities: model.modalities.input,
      supports_search_tool: false,
      use_responses_lite: false
    }))
  };
}

function codexReasoningEffort(
  level: ZroModel["reasoning"]["levels"][number] | undefined
): string | undefined {
  return level ? level.codexEffort ?? level.id : undefined;
}

function buildCodexConfig(
  model: string,
  options: { catalogPath?: string; modelSpec?: ZroModel } = {}
): string {
  const config = [
    `model = ${tomlString(model)}`,
    `model_provider = ${tomlString(PROVIDER_ID)}`,
  ];
  const modelSpec = options.modelSpec;
  if (modelSpec) {
    const defaultReasoningLevel = modelSpec.reasoning.levels.find(
      (level) => level.id === modelSpec.reasoning.defaultLevel
    );
    config.push(`model_context_window = ${modelSpec.contextWindow}`);
    config.push(
      `model_reasoning_effort = ${tomlString(
        codexReasoningEffort(defaultReasoningLevel) ?? modelSpec.reasoning.defaultLevel
      )}`
    );
  }
  if (options.catalogPath) {
    config.push(`model_catalog_json = ${tomlString(options.catalogPath)}`);
  }

  config.push(
    "",
    `[model_providers.${PROVIDER_ID}]`,
    `name = ${tomlString(PROVIDER_NAME)}`,
    `base_url = ${tomlString(BASE_URL)}`,
    `wire_api = "responses"`,
    `env_key = ${tomlString(ZRO_ENV_KEY)}`,
    `supports_websockets = false`,
    "",
    `[mcp_servers.${PROVIDER_ID}]`,
    `url = ${tomlString(MCP_URL)}`,
    `bearer_token_env_var = ${tomlString(ZRO_ENV_KEY)}`,
    "",
    "[otel]",
    `exporter = "none"`,
    `metrics_exporter = "none"`,
    `trace_exporter = "none"`,
    `log_user_prompt = false`,
    "",
    "[analytics]",
    `enabled = false`,
    ""
  );

  return config.join("\n");
}

function dotenvValue(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
