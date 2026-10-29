import { describe, expect, it } from "vitest";
import { parseModelCatalog } from "../src/model-catalog.js";
import { buildCodexConfig, buildCodexModelCatalog } from "../src/engine/tools/codex.js";
import { testModel } from "./fixtures.js";

function catalogModel(id: string, codexEffort: string) {
  return {
    id,
    displayName: id,
    contextWindow: 1048576,
    maxOutputTokens: 64000,
    modalities: { input: ["text"], output: ["text"] },
    reasoning: {
      defaultLevel: "max",
      levels: [
        {
          id: "max",
          description: "Maximum reasoning",
          codexEffort,
          piLevel: "xhigh",
          openCodeOptions: { reasoningEffort: "max" }
        }
      ]
    }
  };
}

describe("model modalities parsing", () => {

  it("rejects an unknown modality value", () => {
    expect(() =>
      parseModelCatalog({
        version: 1,
        default: "bad-model",
        models: [
          {
            id: "bad-model",
            displayName: "Bad Model",
            contextWindow: 200_000,
            maxOutputTokens: 20_000,
            modalities: { input: ["hologram"], output: ["text"] },
            reasoning: {
              defaultLevel: "high",
              levels: [
                {
                  id: "high",
                  description: "Run",
                  piLevel: "high",
                  openCodeOptions: { reasoningEffort: "high" },
                },
              ],
            },
          },
        ],
      }),
    ).toThrow("invalid input modality");
  });
});

describe("codex config clamps remote reasoning efforts", () => {
  const supportedEfforts = new Set(["minimal", "low", "medium", "high", "xhigh", "disabled"]);

  it("rejects an undocumented codexEffort from a remote catalog and clamps via piLevel", () => {
    const catalog = parseModelCatalog({
      version: 1,
      default: "server-model",
      models: [catalogModel("server-model", "max")]
    });
    const config = buildCodexConfig("server-model", { modelSpec: catalog.models[0] });
    expect(config).toContain('model_reasoning_effort = "xhigh"');
  });
});

describe("codex model catalog modalities", () => {
  it("keeps only input modalities Codex supports", () => {
    const catalog = buildCodexModelCatalog([
      testModel("mixed", { input: ["text", "video", "pdf", "image", "audio"], output: ["text"] }),
      testModel("non-text", { input: ["video", "pdf"], output: ["text"] })
    ]);
    const models = catalog.models as Array<{ input_modalities: string[] }>;
    expect(models.map((model) => model.input_modalities)).toEqual([
      ["text", "image", "audio"],
      ["text"]
    ]);
  });
});
