import * as vscode from "vscode";
import {
  CONFIG_SECTION,
  EFFORT_DEFAULT,
  SETTING_REASONING_EFFORT,
  SETTING_REASONING_EFFORT_BY_MODEL,
  type ZroModel,
  type ZroModelConfigurationSchema,
  type ZroReasoningConfig,
} from "./constants.js";

/**
 * Reasoning-effort resolution.
 *
 * VS Code's `languageModelChatProviders` API has no reasoning surface — no
 * thinking response part, no per-request effort field, and `modelOptions` is
 * set by the *caller* (Copilot Chat), not the user. So the extension owns the
 * effort UI: a global setting (`zro.reasoningEffort`), an optional per-model
 * override map (`zro.reasoningEffortByModel`), and a picker command / dashboard
 * control that write those settings.
 *
 * On the wire the effort travels as `reasoning_effort: "<level id>"` on
 * /v1/chat/completions, using the native level ids the proxy advertises
 * ("none", "low", "high", "max", …) — the same token OpenAI-compatible
 * harnesses send through `openCodeOptions.reasoningEffort`. When the resolved
 * value is `default` (or no value is set at all), the key is omitted so the
 * proxy applies the model's native `defaultLevel`.
 *
 * Newer VS Code builds add the missing surface: a model can carry a
 * `configurationSchema` on its chat info, the workbench then renders a
 * "Thinking Effort" picker inside the model picker (group "navigation"), and
 * the chosen value comes back on the request as
 * `options.modelConfiguration.reasoningEffort`. `toChatInfo` attaches that
 * schema when a model advertises reasoning levels; the extension settings
 * remain as the fallback on builds without the surface.
 *
 * Levels are also listed directly: `toChatInfos` expands each reasoning model
 * into one entry per level, using the id encoding below, so a level can be
 * picked straight from the model list. Precedence for a request is: the level
 * entry's own level → the config dropdown value → per-model/global settings →
 * the model's native default. All of this is `default`-friendly: when nothing
 * applies, `reasoning_effort` is omitted from the request.
 */

/** Key of the reasoning-effort property in the model configuration schema. */
export const MODEL_CONFIG_REASONING_EFFORT = "reasoningEffort";

/**
 * Separator between a model id and its reasoning level in a synthetic picker
 * entry id. Reasoning models are advertised once per level so each level is a
 * directly selectable row in the model picker; the entry id carries the level.
 *
 * Two constraints drove the choice: real catalog ids only use single hyphens
 * (`deepseek-v4-flash-0731`), and VS Code treats an id ending in `-fast` as the
 * fast half of a two-way speed-variant toggle — so this neither collides with
 * real ids nor triggers that pairing.
 */
export const EFFORT_ENTRY_SEPARATOR = "--";

/** Picker entry id for one level of a model (e.g. `glm-5.2--high`). */
export function effortEntryId(modelId: string, level: string): string {
  return `${modelId}${EFFORT_ENTRY_SEPARATOR}${level}`;
}

/**
 * Split a picker entry id back into the catalog model id and its fixed level.
 * `level` is undefined for the model's own entry (the plain id), which means
 * "server default" unless a setting or the config dropdown says otherwise.
 */
export function parseEffortEntryId(entryId: string): { modelId: string; level?: string } {
  const at = entryId.lastIndexOf(EFFORT_ENTRY_SEPARATOR);
  if (at <= 0) return { modelId: entryId };
  const level = entryId.slice(at + EFFORT_ENTRY_SEPARATOR.length);
  return level ? { modelId: entryId.slice(0, at), level } : { modelId: entryId };
}

/**
 * Every level except the model's native default, in catalog order. The default
 * level gets no extra entry: the model's own row already means "whatever the
 * server recommends", so a duplicate row would be noise.
 */
export function alternateLevels(reasoning: ZroReasoningConfig | undefined): string[] {
  if (!reasoning?.levels?.length) return [];
  return reasoning.levels
    .map((level) => level.id)
    .filter((id) => id !== reasoning.defaultLevel);
}

/** Short label for a level id, for picker entry names ("none" → "No thinking"). */
export function levelLabel(level: string): string {
  if (level === "none") return "No thinking";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * The per-model configuration schema VS Code renders as the in-picker
 * "Thinking Effort" dropdown. Mirrors the shape Copilot Chat builds for its
 * own models: an enum of the model's level ids, defaulting to the catalog's
 * native default level. `group: "navigation"` promotes it from the
 * "Configure Model…" dialog to the quick dropdown beside the model picker.
 * Returns undefined for models without reasoning levels.
 */
export function buildReasoningConfigurationSchema(
  reasoning: ZroReasoningConfig | undefined
): ZroModelConfigurationSchema | undefined {
  if (!reasoning?.levels?.length) return undefined;
  return {
    properties: {
      [MODEL_CONFIG_REASONING_EFFORT]: {
        type: "string",
        title: "Thinking Effort",
        enum: reasoning.levels.map((level) => level.id),
        enumDescriptions: reasoning.levels.map((level) => level.description),
        default: reasoning.defaultLevel,
        group: "navigation",
      },
    },
  };
}

/**
 * Extract the user's in-picker effort choice from the request options.
 * `modelConfiguration` mirrors back the values selected in the schema-driven
 * UI; anything that isn't a known level id for this model is ignored (the
 * extension settings then apply instead).
 */
export function effortFromModelConfiguration(
  modelConfiguration: unknown,
  reasoning: ZroReasoningConfig | undefined
): string | null {
  if (!reasoning?.levels?.length) return null;
  if (!modelConfiguration || typeof modelConfiguration !== "object") return null;
  const value = (modelConfiguration as Record<string, unknown>)[MODEL_CONFIG_REASONING_EFFORT];
  if (typeof value !== "string" || !value) return null;
  return reasoning.levels.some((level) => level.id === value) ? value : null;
}

/** Result of resolving the effort for a model. `omit` = send nothing. */
export interface EffectiveEffort {
  /** The level id to send, or null to omit `reasoning_effort` from the request. */
  level: string | null;
  /** Where the value came from, for UI display ("model", "global", "server"). */
  source: "model" | "global" | "server";
}

/** Read the raw configured values (global default + per-model overrides). */
export function readEffortSettings(): { global: string; perModel: Record<string, string> } {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const globalRaw = config.get<string>(SETTING_REASONING_EFFORT);
  const perModelRaw = config.get<Record<string, string>>(SETTING_REASONING_EFFORT_BY_MODEL);
  return {
    global: typeof globalRaw === "string" ? globalRaw : EFFORT_DEFAULT,
    perModel: perModelRaw && typeof perModelRaw === "object" ? { ...perModelRaw } : {},
  };
}

/**
 * Resolve the effort to apply for a model. Per-model override beats the global
 * setting; anything not understood is treated as "unset". Returns the level to
 * send plus where it came from — `source: "server"` means omit the param and
 * let the proxy use the model's native default.
 */
export function resolveEffort(
  modelId: string,
  reasoning: ZroReasoningConfig | undefined,
  settings = readEffortSettings()
): EffectiveEffort {
  // A model that advertises no levels can't reason at all: nothing is sent, so
  // report "server" rather than attributing it to a setting that has no effect.
  if (!reasoning?.levels?.length) {
    return { level: null, source: "server" };
  }
  const perModel = settings.perModel[modelId];
  if (perModel && perModel !== EFFORT_DEFAULT) {
    return { level: clampToModel(reasoning, perModel), source: "model" };
  }
  if (settings.global && settings.global !== EFFORT_DEFAULT) {
    return { level: clampToModel(reasoning, settings.global), source: "global" };
  }
  return { level: null, source: "server" };
}

/**
 * Nearest supported level to a user-configured value. Exact match first;
 * otherwise fall back to the block's default level, or null when there are no
 * reasoning levels.
 */
function clampToModel(reasoning: ZroReasoningConfig | undefined, effort: string): string | null {
  if (!reasoning?.levels?.length) return null;
  const levels = reasoning.levels;
  if (levels.some((level) => level.id === effort)) return effort;

  // Tolerate reasonable aliases that come from other hosts' effort vocabularies.
  const aliases: Record<string, string> = {
    off: "none",
    disabled: "none",
    enabled: reasoning.defaultLevel,
  };
  const aliased = aliases[effort];
  if (aliased && levels.some((level) => level.id === aliased)) return aliased;

  return reasoning.defaultLevel;
}

/**
 * What should be sent on the wire for a model, given the current settings.
 * Returns null when the parameter should be omitted.
 */
export function effortForRequest(
  modelId: string,
  reasoning: ZroReasoningConfig | undefined
): string | null {
  if (!reasoning?.levels.length) return null;
  return resolveEffort(modelId, reasoning).level;
}

/** Persist an effort value. `DEFAULT` value clears the key. */
export async function setEffort(
  modelId: string | null,
  effort: string,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  if (modelId) {
    const perModel = config.get<Record<string, string>>(SETTING_REASONING_EFFORT_BY_MODEL) ?? {};
    const next = { ...perModel };
    if (effort === EFFORT_DEFAULT) delete next[modelId];
    else next[modelId] = effort;
    await config.update(SETTING_REASONING_EFFORT_BY_MODEL, next, target);
  } else {
    await config.update(SETTING_REASONING_EFFORT, effort === EFFORT_DEFAULT ? undefined : effort, target);
  }
}

/**
 * Interactive quick-pick: choose a model (only ones carrying reasoning levels),
 * then one of its levels (plus "Default"). Writes the per-model override.
 */
export async function promptForEffort(models: readonly ZroModel[]): Promise<void> {
  const withReasoning = models.filter((model) => model.reasoning?.levels?.length);
  if (withReasoning.length === 0) {
    vscode.window.showInformationMessage("No ZRO models advertise reasoning levels yet.");
    return;
  }

  interface TargetPick extends vscode.QuickPickItem {
    modelId: string | null; // null = global default
  }
  const target = await vscode.window.showQuickPick<TargetPick>(
    [
      {
        label: "$(globe) Global default",
        description: "Apply one effort to every ZRO model",
        modelId: null,
      },
      ...withReasoning.map<TargetPick>((model) => ({
        label: `$(symbol-misc) ${model.displayName}`,
        description: model.id,
        modelId: model.id,
      })),
    ],
    { placeHolder: "Set reasoning effort for…" }
  );
  if (!target) return;

  const settings = readEffortSettings();

  interface LevelPick extends vscode.QuickPickItem {
    effort: string;
  }
  const chosen =
    target.modelId === null
      ? await pickGlobalLevel(withReasoning, settings.global)
      : await pickModelLevel(withReasoning.find((m) => m.id === target.modelId)!, settings.perModel[target.modelId]);
  if (!chosen) return;

  await setEffort(target.modelId, chosen.effort);
  const scope = target.modelId ? (withReasoning.find((m) => m.id === target.modelId)?.displayName ?? target.modelId) : "ZRO models";
  vscode.window.showInformationMessage(
    chosen.effort === EFFORT_DEFAULT
      ? `${scope}: reasoning effort reset to the server default.`
      : `${scope}: reasoning effort set to "${chosen.effort}".`
  );
}

/** Human-readable summary of the current effort for a model. */
export function effortLabel(model: ZroModel): string {
  const effective = resolveEffort(model.id, model.reasoning);
  const level = effective.level ?? model.reasoning?.defaultLevel ?? "default";
  const suffix = effective.source === "model" ? " (per-model)" : effective.source === "global" ? " (global)" : " (server default)";
  return `${level}${suffix}`;
}

/** Quick-pick for one model's reasoning levels. */
async function pickModelLevel(
  model: ZroModel,
  current: string | undefined
): Promise<{ effort: string } | undefined> {
  const levels = model.reasoning?.levels ?? [];
  const satisfied = current ?? EFFORT_DEFAULT;
  const defaultLevel = model.reasoning?.defaultLevel ?? levels[0]?.id;
  const picks: Array<vscode.QuickPickItem & { effort: string }> = [
    {
      label: `$(server) Default${satisfied === EFFORT_DEFAULT ? " (current)" : ""}`,
      description: `Use the server's native level (${defaultLevel})`,
      effort: EFFORT_DEFAULT,
    },
    ...levels.map((level) => ({
      label: `${satisfied === level.id ? "$(check) " : "$(circle-dot) "}${level.id}`,
      description: level.description,
      effort: level.id,
    })),
  ];
  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: `Reasoning effort for ${model.displayName}`,
  });
  return selected;
}

/** Quick-pick for the global default (uses the union of all models' levels). */
async function pickGlobalLevel(
  models: readonly ZroModel[],
  current: string
): Promise<{ effort: string } | undefined> {
  const known = new Map<string, string>();
  for (const model of models) {
    for (const level of model.reasoning?.levels ?? []) {
      known.set(level.id, level.description);
    }
  }
  const picks: Array<vscode.QuickPickItem & { effort: string }> = [
    {
      label: `$(server) Default${current === EFFORT_DEFAULT ? " (current)" : ""}`,
      description: "Let each model use its native server default",
      effort: EFFORT_DEFAULT,
    },
    ...[...known.entries()].map(([id, description]) => ({
      label: `${current === id ? "$(check) " : "$(circle-dot) "}${id}`,
      description,
      effort: id,
    })),
  ];
  return vscode.window.showQuickPick(picks, {
    placeHolder: "Default reasoning effort for all ZRO models",
  });
}
