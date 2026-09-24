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
    const aliasPlan = resolveClaudeAliases(ctx.model, ctx.models, ctx.modelAliases);
    const sessionBudget = claudeSessionBudget(ctx.model, ctx.models, aliasPlan);
    return {
      tool: "claude",
      label: "Claude Code",
      model: ctx.model,
      command: "claude",
      args: [
        "--model",
        claudeModelId(ctx.model, claudeSpecFor(ctx.model, ctx.models), sessionBudget),
        "--managed-settings",
        buildClaudeManagedSettingsArg(ctx.models, aliasPlan),
        "--mcp-config",
        mcpConfigPath,
        ...ctx.extraArgs
      ],
      env: {
        ANTHROPIC_BASE_URL: ENDPOINT_ROOT,
        ANTHROPIC_AUTH_TOKEN: ctx.apiKey,
        ...buildClaudeModelEnv(ctx.model, ctx.models, aliasPlan, sessionBudget),
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

// Every allowlisted value is drawn from the validated catalog or the fixed
// tier-alias set — never from a caller-supplied model string — because this
// JSON is handed to Claude Code, a separate trust domain. With
// enforceAvailableModels on, Claude Code drops any /model row whose value is
// not in availableModels, and an allowlisted alias with no seated model
// re-enables that row resolving to Claude Code's built-in Anthropic model,
// which the Zro base URL cannot serve.
function buildClaudeManagedSettingsArg(
  modelSpecs: readonly ZroModel[],
  aliasPlan: ClaudeAliasPlan
): string {
  const seatedSlots = CLAUDE_MODEL_ALIAS_SLOTS.filter((slot) => aliasPlan.mapping[slot]);
  return JSON.stringify({
    availableModels: [
      ...modelSpecs.map((model) => model.id),
      ...seatedSlots.map((slot) => slot.toLowerCase())
    ],
    enforceAvailableModels: true,
    permissions: {
      deny: ["WebSearch"]
    }
  });
}

const ONE_MILLION = 1048576;

interface ClaudeAliasPlan {
  mapping: Record<string, string>;
}

// Alias slots: explicit --alias values win and reserve their model — even
// when that inverts the tier ordering, the user asked for it; the remaining
// slots fill from the unclaimed catalog, tier-mapped by output capacity
// (opus gets the beefiest, haiku — used for cheap background tasks — the
// smallest) with deterministic tie-breaks so the mapping never depends on
// catalog order. Writing these into plan.env is deliberate: Zro owns the
// alias routing for its launches, and dropping a slot with --alias haiku=
// leaves any user shell value untouched. Slots the catalog cannot fill stay
// unfilled, and the caller must not advertise them either.
function resolveClaudeAliases(
  selectedModel: string,
  modelSpecs: readonly ZroModel[],
  modelAliases: Readonly<Record<string, string>> = {}
): ClaudeAliasPlan {
  const claimed = new Set([selectedModel]);
  const dropped = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const [slot, modelId] of Object.entries(modelAliases)) {
    if (modelId) {
      mapping[slot] = modelId;
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
    if (dropped.has(slot) || mapping[slot]) continue;
    if (cursor >= fillCandidates.length) break;
    mapping[slot] = fillCandidates[cursor++].id;
  }
  // A slot is only seated when its model is representable in this catalog: the
  // env writer cannot emit a value for a model the catalog does not carry, and
  // an allowlisted-but-unemitted alias would re-enable Claude Code's built-in
  // Anthropic row. Filtering here keeps the managed settings and the env in
  // agreement for callers that reach launch() with a model outside `modelSpecs`.
  for (const slot of Object.keys(mapping)) {
    if (!modelSpecs.some((model) => model.id === mapping[slot])) delete mapping[slot];
  }
  return { mapping };
}

// The session's context budget: the smallest window across the selection and
// every seated slot, since Claude Code holds one budget per launch. Undefined
// when no model in the session has a known window (an unknown-in-both model
// with no seated slots). launch() warns about the unknown selection.
function claudeSessionBudget(
  selectedModel: string,
  modelSpecs: readonly ZroModel[],
  aliasPlan: ClaudeAliasPlan
): number | undefined {
  const specs = [
    claudeSpecFor(selectedModel, modelSpecs),
    ...Object.values(aliasPlan.mapping).map((modelId) => claudeSpecFor(modelId, modelSpecs))
  ].filter((spec): spec is ZroModel => Boolean(spec));
  return specs.length > 0 ? Math.min(...specs.map((spec) => spec.contextWindow)) : undefined;
}

// The active catalog is authoritative, but a caller may pass a model the remote
// catalog no longer lists; fall back to the bundled lineup so a known model
// still gets its real window. An unknown-in-both model resolves to undefined.
function claudeSpecFor(
  modelId: string,
  modelSpecs: readonly ZroModel[]
): ZroModel | undefined {
  return modelSpecs.find((m) => m.id === modelId) ?? ZRO_MODELS.find((m) => m.id === modelId);
}

function buildClaudeModelEnv(
  selectedModel: string,
  modelSpecs: readonly ZroModel[],
  aliasPlan: ClaudeAliasPlan,
  sessionBudget: number | undefined
): Record<string, string> {
  const aliasMapping = aliasPlan.mapping;

  const env: Record<string, string> = {
    ANTHROPIC_CUSTOM_MODEL_OPTION: claudeModelId(selectedModel, claudeSpecFor(selectedModel, modelSpecs), sessionBudget),
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: claudeModelName(selectedModel, modelSpecs, sessionBudget),
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: `${PROVIDER_NAME} model via ${ENDPOINT_ROOT}`
  };

  // aliasPlan.mapping is already filtered to models this catalog carries, so
  // every seated slot here is emitted and every emitted slot is allowlisted.
  for (const [slot, modelId] of Object.entries(aliasMapping)) {
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL`] = claudeModelId(
      modelId,
      claudeSpecFor(modelId, modelSpecs),
      sessionBudget
    );
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_NAME`] = claudeModelName(modelId, modelSpecs, sessionBudget);
    env[`ANTHROPIC_DEFAULT_${slot}_MODEL_DESCRIPTION`] = `${PROVIDER_NAME} model via ${ENDPOINT_ROOT}`;
  }

  if (sessionBudget !== undefined) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(sessionBudget);
  }

  return env;
}

function claudeModelId(
  modelId: string,
  spec: ZroModel | undefined,
  sessionBudget: number | undefined
): string {
  return `${modelId}${claudeContextMarker(spec, sessionBudget)}`;
}

function claudeModelName(
  modelId: string,
  modelSpecs: readonly ZroModel[],
  sessionBudget: number | undefined
): string {
  const spec = claudeSpecFor(modelId, modelSpecs);
  const displayName = spec?.displayName ?? modelId;
  return `${PROVIDER_NAME} ${displayName}${claudeContextMarker(spec, sessionBudget)}`;
}

// The [1m] marker goes on both the model id and its label from a single
// predicate, so the two can never disagree. It requires a known model with a
// >= 1M window and a >= 1M session budget: Claude Code clamps the whole session
// to the smallest window, so a 1M model in a mixed-window session is not
// advertised as 1M.
function claudeContextMarker(
  spec: ZroModel | undefined,
  sessionBudget: number | undefined
): string {
  if (!spec || spec.contextWindow < ONE_MILLION) return "";
  if (sessionBudget === undefined || sessionBudget < ONE_MILLION) return "";
  return "[1m]";
}
