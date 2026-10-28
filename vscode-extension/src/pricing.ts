import { PRICING_MULTIPLIER, type ZroModelPricing } from "./constants.js";

/**
 * Cost metadata core understands, mirroring the subset of the (undocumented)
 * `LanguageModelChatInformation` fields the picker renders. See
 * `ZroChatInformation` in constants.ts for why the three travel together.
 */
export interface ZroPricingMetadata {
  pricing: string;
  multiplierNumeric: number;
  priceCategory: string;
}

/**
 * Formats a USD rate per 1M tokens. Two decimals is the floor so `$0.30` never
 * renders as `$0.3`; four is the ceiling so cheap cache-read rates keep their
 * significant digits (`$0.006`).
 */
function usdPer1M(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

/**
 * Per-request price summary for the Copilot model picker, e.g.
 * `$0.30 in · $1.20 out per 1M tokens`. Core appends this to the model row's
 * description and renders it as "Cost: …" in the row's hover card.
 */
export function pricingLabel(pricing: ZroModelPricing): string {
  return `${usdPer1M(pricing.inputPer1M)} in · ${usdPer1M(pricing.outputPer1M)} out per 1M tokens`;
}

/**
 * Cost bucket core renders as a hover-card badge ("Low cost", "Medium cost",
 * "High cost", "Very high cost").
 *
 * Thresholds are on the blended `(input + output) / 2` rate in USD per 1M
 * tokens, so a model that is cheap to read but expensive to write is not filed
 * as cheap. They are absolute rather than relative to the other ZRO models:
 * the badge describes how expensive a model is on its own, and a relative
 * scale would silently relabel every model whenever the catalog's lineup or
 * pricing changes.
 */
export function priceCategoryFor(
  pricing: ZroModelPricing
): "low" | "medium" | "high" | "very_high" {
  const blended = (pricing.inputPer1M + pricing.outputPer1M) / 2;
  if (blended < 0.5) return "low";
  if (blended < 1.5) return "medium";
  if (blended < 4) return "high";
  return "very_high";
}

/**
 * Cost metadata for a chat model, or undefined when the catalog published no
 * rates for it.
 *
 * All three fields are set, or none: core ignores `pricing` unless
 * `multiplierNumeric` is present, and a lone `priceCategory` would render a
 * "… cost" badge with no price behind it.
 */
export function pricingMetadata(
  pricing: ZroModelPricing | undefined
): ZroPricingMetadata | undefined {
  if (!pricing) return undefined;
  return {
    pricing: pricingLabel(pricing),
    multiplierNumeric: PRICING_MULTIPLIER,
    priceCategory: priceCategoryFor(pricing),
  };
}