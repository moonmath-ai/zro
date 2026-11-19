import { describe, expect, it } from "vitest";
import type { ZroModel, ZroModalities } from "../src/engine/constants.js";
import { buildCodexConfig, buildCodexModelCatalog } from "../src/engine/tools/codex.js";
import { testModel } from "./fixtures.js";

const TEXT: ZroModalities = { input: ["text"], output: ["text"] };

interface CatalogEntry {
  slug: string;
  context_window: number;
  max_context_window: number;
  effective_context_window_percent: number;
  truncation_policy: { mode: string; limit: number };
}

function catalogEntries(models: readonly ZroModel[]): CatalogEntry[] {
  return buildCodexModelCatalog(models).models as CatalogEntry[];
}

describe("codex model catalog tool-output budget", () => {
  it("uses the Codex default per-tool-output budget instead of the context window", () => {
    const models = [
      testModel("small", TEXT),
      { ...testModel("one-million", TEXT), contextWindow: 1_048_576 }
    ];

    for (const entry of catalogEntries(models)) {
      expect(entry.truncation_policy).toEqual({ mode: "tokens", limit: 10_000 });
    }
  });

  it("keeps the advertised context window independent of the tool-output budget", () => {
    const entry = catalogEntries([
      { ...testModel("one-million", TEXT), contextWindow: 1_048_576 }
    ])[0];

    expect(entry.context_window).toBe(1_048_576);
    expect(entry.max_context_window).toBe(1_048_576);
    expect(entry.effective_context_window_percent).toBe(95);
    expect(entry.truncation_policy.limit).toBeLessThan(entry.context_window);
  });

  it("still passes the model context window to Codex config", () => {
    const model = { ...testModel("one-million", TEXT), contextWindow: 1_048_576 };

    expect(buildCodexConfig(model.id, { modelSpec: model })).toContain(
      "model_context_window = 1048576"
    );
  });
});
