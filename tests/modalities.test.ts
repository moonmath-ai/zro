import { describe, expect, it } from "vitest";
import { parseModelCatalog, parsePublicCatalog } from "../src/model-catalog.js";
import { buildCodexModelCatalog } from "../src/engine/tools/codex.js";
import { buildOpenCodeConfig } from "../src/engine/tools/opencode.js";
import { TEST_MODELS, testModel as model } from "./fixtures.js";

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

describe("public catalog parsing carries modalities and synthesizes reasoning", () => {
  const catalog = parsePublicCatalog({
    data: [
      {
        id: "kimi-k3",
        name: "Kimi K3",
        context_length: 1_048_576,
        max_output_length: 1_048_576,
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        supported_features: ["tools", "reasoning"],
      },
      {
        id: "plain-model",
        name: "Plain Model",
        context_length: 200_000,
        max_output_length: 20_000,
        input_modalities: ["text"],
        output_modalities: ["text"],
        supported_features: ["tools"],
      },
    ],
  });
  const byId = new Map(catalog.models.map((m) => [m.id, m]));

  it("maps input/output modalities", () => {
    expect(byId.get("kimi-k3")?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
  });

  it("gives reasoning models a reasoning level set", () => {
    expect(byId.get("kimi-k3")?.reasoning.levels.map((level) => level.id)).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
  });

  it("gives non-reasoning models a single off level", () => {
    expect(byId.get("plain-model")?.reasoning).toMatchObject({
      defaultLevel: "none",
      levels: [{ id: "none", piLevel: "off" }],
    });
  });

  it("defaults to the first model returned", () => {
    expect(catalog.default).toBe("kimi-k3");
  });
});

describe("codex emitter derives input_modalities from the model", () => {
  it("marks image-aware models with image input and text models as text-only", () => {
    const catalog = buildCodexModelCatalog([
      ...TEST_MODELS,
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
      ...TEST_MODELS,
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

  it("honors the kimi-k3 vision flag", () => {
    expect(models["kimi-k3"]?.attachment).toBe(true);
    expect(models["kimi-k3"]?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
  });
});