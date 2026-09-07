import { describe, expect, it } from "vitest";
import { parseModelCatalog } from "../src/model-catalog.js";
import { buildCodexModelCatalog } from "../src/engine/tools/codex.js";
import { buildOpenCodeConfig } from "../src/engine/tools/opencode.js";
import { ZRO_MODELS, type ZroModel, type ZroModalities } from "../src/engine/constants.js";

function model(id: string, modalities: ZroModalities): ZroModel {
  return {
    id,
    displayName: id,
    contextWindow: 200_000,
    maxOutputTokens: 20_000,
    modalities,
    reasoning: {
      defaultLevel: "high",
      levels: [
        {
          id: "high",
          description: "Reason carefully",
          piLevel: "high",
          openCodeOptions: { reasoningEffort: "high" },
        },
      ],
    },
  };
}

describe("model modalities parsing", () => {
  it("carries image modalities through the catalog parser", () => {
    const catalog = parseModelCatalog({
      version: 1,
      default: "vision-model",
      models: [
        {
          id: "vision-model",
          displayName: "Vision Model",
          contextWindow: 200_000,
          maxOutputTokens: 20_000,
          modalities: { input: ["text", "image", "pdf"], output: ["text"] },
          reasoning: {
            defaultLevel: "high",
            levels: [
              {
                id: "high",
                description: "Reason carefully",
                piLevel: "high",
                openCodeOptions: { reasoningEffort: "high" },
              },
            ],
          },
        },
      ],
    });

    expect(catalog.models[0].modalities).toEqual({
      input: ["text", "image", "pdf"],
      output: ["text"],
    });
  });

  it("defaults missing modalities to text-only", () => {
    const catalog = parseModelCatalog({
      version: 1,
      default: "legacy-model",
      models: [
        {
          id: "legacy-model",
          displayName: "Legacy Model",
          contextWindow: 200_000,
          maxOutputTokens: 20_000,
          reasoning: {
            defaultLevel: "high",
            levels: [
              {
                id: "high",
                description: "Reason carefully",
                piLevel: "high",
                openCodeOptions: { reasoningEffort: "high" },
              },
            ],
          },
        },
      ],
    });

    expect(catalog.models[0].modalities).toEqual({ input: ["text"], output: ["text"] });
  });

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

describe("bundled ZRO_MODELS carry the verified modality mapping", () => {
  // Corrected per Eitan's image-capability verification (path-relevant models only):
  // vision (input text+image): kimi-k3, glm-5.3-flash, minimax-m3, dolly1 (alias of glm-5.3-flash)
  // text-only: glm-5.3, glm-5.2, deepseek-v4-flash-0731
  // NOTE: the offline CLI bundle only carries kimi-k3, glm-5.2, deepseek-v4-flash-0731;
  // dolly1 / glm-5.3* / minimax-m3 arrive via the remote catalog (which is authoritative).
  const byId = new Map(ZRO_MODELS.map((m) => [m.id, m]));

  it("kimi-k3 is image-aware", () => {
    expect(byId.get("kimi-k3")?.modalities.input).toEqual(["text", "image"]);
  });

  it("glm-5.2 and deepseek-v4-flash-0731 are text-only", () => {
    expect(byId.get("glm-5.2")?.modalities.input).toEqual(["text"]);
    expect(byId.get("deepseek-v4-flash-0731")?.modalities.input).toEqual(["text"]);
  });
});

describe("codex emitter derives input_modalities from the model", () => {
  it("marks image-aware models with image input and text models as text-only", () => {
    const catalog = buildCodexModelCatalog([
      ...ZRO_MODELS,
      model("glm-5.3-flash", { input: ["text", "image"], output: ["text"] }),
    ]);
    const models = catalog.models as Array<Record<string, unknown>>;

    const flash = models.find((entry) => entry.slug === "glm-5.3-flash");
    expect(flash).toBeDefined();
    expect(flash?.input_modalities).toEqual(["text", "image"]);

    const deepseek = models.find((entry) => entry.slug === "deepseek-v4-flash-0731");
    expect(deepseek?.input_modalities).toEqual(["text"]);
  });
});

describe("opencode emitter enables attachments for image-capable models", () => {
  const config = buildOpenCodeConfig(
    {},
    "sk-test",
    [
      ...ZRO_MODELS,
      model("glm-5.3-flash", { input: ["text", "image"], output: ["text"] }),
    ],
    false,
  );
  const provider = config.provider as Record<string, Record<string, unknown>> | undefined;
  const providerModels = (provider?.zro?.models as Record<string, Record<string, unknown>> | undefined) ?? {};
  const models: Record<string, Record<string, unknown>> = providerModels;

  it("sets attachment + modalities on vision models", () => {
    expect(models["glm-5.3-flash"]?.attachment).toBe(true);
    expect(models["glm-5.3-flash"]?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
  });

  it("does not advertise attachment for text-only models", () => {
    expect(models["deepseek-v4-flash-0731"]?.attachment).toBe(false);
    expect(models["deepseek-v4-flash-0731"]?.modalities).toEqual({ input: ["text"], output: ["text"] });
  });

  it("still honors the kimi-k3 bundled vision flag", () => {
    expect(models["kimi-k3"]?.attachment).toBe(true);
    expect(models["kimi-k3"]?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
  });
});