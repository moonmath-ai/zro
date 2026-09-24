import assert from "node:assert/strict";

// Model selection helpers shared by the live-API and compatibility CI probes.
// Probe models are resolved from the live catalog (`zro models --json`) instead
// of being pinned in the scripts, so retiring a model cannot break CI on its
// own. Set ZRO_CI_MODEL to force one model.

export function reasoningLevels(model) {
  return Array.isArray(model.reasoning?.levels) ? model.reasoning.levels : [];
}

// Cache probes assert zero reasoning tokens, so the warm-up model needs a level
// that disables reasoning outright.
export function disableLevelOf(model) {
  return reasoningLevels(model).find(
    (level) => level.id === "none" || level.piLevel === "off" || level.codexEffort === "disabled"
  );
}

// Reasoning probes exercise the strongest reasoning level a model offers.
export function maxLevelOf(model) {
  const levels = reasoningLevels(model);
  return levels.find((level) => level.id === "max")
    ?? levels.find((level) => level.id === "xhigh" || level.piLevel === "xhigh")
    ?? null;
}

// Picks one model for the cache probes and one for the reasoning probes. The
// catalog default wins when it supports both probe shapes; otherwise capable
// models are scanned in catalog order; otherwise the probes are split across
// two models. Throws with the available model list when nothing qualifies.
export function selectProbeModels(catalog, override) {
  const models = catalogModels(catalog);
  const available = models.map((model) => model.id).join(", ");

  if (override) {
    const model = models.find((candidate) => candidate.id === override);
    assert.ok(model, `ZRO_CI_MODEL "${override}" is not in the Zro model catalog. Available models: ${available}`);
    if (!disableLevelOf(model) || !maxLevelOf(model)) {
      console.warn(`ZRO_CI_MODEL "${override}" lacks a reasoning-off or max level; the matching probes may fail.`);
    }
    return { cacheModel: model, maxModel: model, catalogDefault: catalog.default ?? null };
  }

  const preferred = models.find((model) => model.id === catalog.default) ?? models[0];
  const capable = disableLevelOf(preferred) && maxLevelOf(preferred)
    ? preferred
    : models.find((model) => disableLevelOf(model) && maxLevelOf(model));
  if (capable) {
    return { cacheModel: capable, maxModel: capable, catalogDefault: catalog.default ?? null };
  }
  // No single model supports both probe shapes; split the probes across models.
  const cacheModel = models.find((model) => disableLevelOf(model));
  const maxModel = models.find((model) => maxLevelOf(model));
  assert.ok(
    cacheModel && maxModel,
    `No Zro model offers a reasoning-off and a max reasoning level. Available models: ${available}`
  );
  return { cacheModel, maxModel, catalogDefault: catalog.default ?? null };
}

// The compatibility probes launch with one representative model and derive
// every assertion from that model's own catalog metadata, so any model works.
export function resolveLaunchModel(catalog, override) {
  const models = catalogModels(catalog);
  const available = models.map((model) => model.id).join(", ");
  const id = override || catalog.default || models[0]?.id;
  const model = models.find((candidate) => candidate.id === id);
  assert.ok(model, `Model "${id}" is not in the Zro model catalog. Available models: ${available}`);
  return model;
}

export function catalogModels(catalog) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  assert.ok(models.length > 0, "Zro model catalog emitted no models");
  return models;
}

// Replicates how the Pi and Prime model lists render token counts, e.g.
// 524288 -> "524.3K", 64000 -> "64K", 1048576 -> "1.0M", 384000 -> "384K".
export function formatPiTokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
}

const OMP_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];

// Mirrors the Oh My Pi adapter: a model's omp thinking value for a level is its
// id when omp knows that name, else its piLevel.
export function ompThinkingLevel(level) {
  return OMP_THINKING_LEVELS.includes(level.id) ? level.id : level.piLevel;
}

// Mirrors ompOffFallback in the adapter: omp exposes a "minimal" thinking level
// as the fallback for a model's reasoning-off level, unless another level
// already occupies the "minimal" slot.
export function ompHasOffFallback(model) {
  const offLevel = reasoningLevels(model).find((level) => level.piLevel === "off");
  if (!offLevel) return false;
  return !reasoningLevels(model).some(
    (level) => level.piLevel !== "off" && ompThinkingLevel(level) === "minimal"
  );
}
