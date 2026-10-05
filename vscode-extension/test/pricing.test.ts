import { describe, expect, it } from "vitest";
import { priceCategoryFor, pricingLabel, pricingMetadata } from "../src/pricing.js";

describe("pricingLabel", () => {
  it("pads to two decimals", () => {
    expect(pricingLabel({ inputPer1M: 0.3, outputPer1M: 1.2 })).toBe(
      "$0.30 in · $1.20 out per 1M tokens"
    );
  });

  it("keeps sub-cent precision", () => {
    expect(pricingLabel({ inputPer1M: 0.0005, outputPer1M: 0.006 })).toBe(
      "$0.0005 in · $0.006 out per 1M tokens"
    );
  });
});

describe("priceCategoryFor", () => {
  it("buckets on the blended rate", () => {
    // The rates below are the real ones the control plane publishes, after
    // promotions.
    expect(priceCategoryFor({ inputPer1M: 0.15, outputPer1M: 0.6 })).toBe("low");
    expect(priceCategoryFor({ inputPer1M: 0.45, outputPer1M: 1.5 })).toBe("medium");
    expect(priceCategoryFor({ inputPer1M: 1.4, outputPer1M: 4.4 })).toBe("high");
    expect(priceCategoryFor({ inputPer1M: 2.5, outputPer1M: 12 })).toBe("very_high");
  });

  it("does not file an expensive-output model as cheap", () => {
    // Input alone would read as "low"; the blend lands it in "medium".
    expect(priceCategoryFor({ inputPer1M: 0.1, outputPer1M: 1 })).toBe("medium");
  });
});

describe("pricingMetadata", () => {
  it("returns all three fields together", () => {
    expect(pricingMetadata({ inputPer1M: 0.3, outputPer1M: 1.2 })).toEqual({
      pricing: "$0.30 in · $1.20 out per 1M tokens",
      multiplierNumeric: 1,
      priceCategory: "medium"
    });
  });

  it("returns nothing for an unpriced model", () => {
    expect(pricingMetadata(undefined)).toBeUndefined();
  });
});