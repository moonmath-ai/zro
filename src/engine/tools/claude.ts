import path from "node:path";
import { ENDPOINT_ROOT, MCP_URL, PROVIDER_NAME, ZRO_MODELS, type ZroModel } from "../constants.js";
import { jsonSerializer } from "../serializers.js";
import type { ToolModule } from "../types.js";

export const claudeTool: ToolModule = {
  id: "claude",
  label: "Claude Code",
  async launch(ctx) {
    const mcpConfigPath = path.join(ctx.tempDir, "claude", "mcp.json");
    if (!ctx.models.some((model) => model.id === ctx.model)
      && !ZRO_MODELS.some((model) => model.id === ctx.model)) {
      ctx.stderr.write(
        `Warning: model "${ctx.model}" is not in the Zro catalog; Claude Code will assume a 200k context window.\n`
      );
    }
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

  // Alias slots: explicit --alias values win and reserve their model — even
  // when that inverts the tier ordering, the user asked for it; the remaining
  // slots fill from the unclaimed catalog, tier-mapped by output capacity
  // (opus gets the beefiest, haiku — used for cheap background tasks — the
  // smallest) with deterministic tie-breaks so the mapping never depends on
  // catalog order. Writing these into plan.env is deliberate: Zro owns the
  // alias routing for its launches, and dropping a slot with --alias haiku=
  // leaves any user shell value untouched.
  const claimed = new Set([selectedModel]);
  const dropped = new Set<string>();
  const aliasMapping: Record<string, string> = {};
  for (const [slot, modelId] of Object.entries(modelAliases)) {
    if (modelId) {
      aliasMapping[slot] = modelId;
      claimed.add(modelId);
    } else {
      dropped.add(slot);
    }
  }
  const fillCandidates = modelSpecs
    .filter((model) => !claimed.has(model.id))
    .sort((a, b) =>
      b.maxOutputTokens - a.maxOutputTokens ||
      b.contextWindow - a.contextWindow ||
      a.id.localeCompare(b.id)
    );
  let cursor = 0;
  for (const slot of CLAUDE_MODEL_ALIAS_SLOTS) {
    if (dropped.has(slot) || aliasMapping[slot]) continue;
    if (cursor >= fillCandidates.length) break;
    aliasMapping[slot] = fillCandidates[cursor++].id;
  }

  // The active catalog is authoritative, but a caller may pass a model the
  // remote catalog no longer lists; fall back to the bundled lineup so a
  // known model still gets its real window. An unknown-in-both model gets no
  // budget here — launch() warns so the degradation is not silent.
  const selectedSpec = modelSpecs.find((m) => m.id === selectedModel)
    ?? ZRO_MODELS.find((m) => m.id === selectedModel);

  for (const [slot, modelId] of Object.entries(aliasMapping)) {
    if (!modelSpecs.some((model) => model.id === modelId)) continue;
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL`] = claudeModelId(modelId, modelSpecs);
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_NAME`] = claudeModelName(modelId, modelSpecs);
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_DESCRIPTION`] = `${PROVIDER_NAME} model via ${ENDPOINT_ROOT}`;
  }

  // Claude Code holds one context budget per launch, but every model that can
  // run in the session — the selection and each filled alias slot — has its
  // own window. Budget for the smallest so a mixed-window catalog compacts
  // instead of erroring.
  const sessionSpecs = [
    selectedSpec,
    ...Object.values(aliasMapping)
      .map((modelId) => modelSpecs.find((model) => model.id === modelId))
  ].filter((spec): spec is ZroModel => Boolean(spec));
  if (sessionSpecs.length > 0) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(
      Math.min(...sessionSpecs.map((spec) => spec.contextWindow))
    );
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
