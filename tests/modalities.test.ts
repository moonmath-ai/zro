import { describe, expect, it } from "vitest";
import { parseModelCatalog } from "../src/model-catalog.js";
import { buildCodexConfig, buildCodexModelCatalog } from "../src/engine/tools/codex.js";
import { buildOpenCodeConfig } from "../src/engine/tools/opencode.js";
import { ZRO_MODELS } from "../src/engine/constants.js";

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
  // Vision (input text+image): kimi-k3, glm-5.3-flash, deepseek-v4.1-flash, dolly1-security
  // Text-only: glm-5.3, auto
  // The remote catalog (which is authoritative) carries the same mapping.
  const byId = new Map(ZRO_MODELS.map((m) => [m.id, m]));

  it("kimi-k3 is image-aware", () => {
    expect(byId.get("kimi-k3")?.modalities.input).toEqual(["text", "image"]);
  });

  it("glm-5.3 is text-only", () => {
    expect(byId.get("glm-5.3")?.modalities.input).toEqual(["text"]);
  });

  it("glm-5.3-flash, deepseek-v4.1-flash, and dolly1-security are image-aware", () => {
    for (const id of ["glm-5.3-flash", "deepseek-v4.1-flash", "dolly1-security"]) {
      expect(byId.get(id)?.modalities.input).toEqual(["text", "image"]);
    }
  });
});

describe("codex emitter derives input_modalities from the model", () => {
  it("marks image-aware models with image input and text models as text-only", () => {
    const catalog = buildCodexModelCatalog(ZRO_MODELS);
    const models = catalog.models as Array<Record<string, unknown>>;

    const flash = models.find((entry) => entry.slug === "glm-5.3-flash");
    expect(flash).toBeDefined();
    expect(flash?.input_modalities).toEqual(["text", "image"]);

    const glm = models.find((entry) => entry.slug === "glm-5.3");
    expect(glm?.input_modalities).toEqual(["text"]);
  });
});

describe("codex config writes a documented reasoning effort for every bundled default", () => {
  const supportedEfforts = new Set(["minimal", "low", "medium", "high", "xhigh", "disabled"]);

  it("never emits a bare level id like 'auto' into model_reasoning_effort", () => {
    for (const model of ZRO_MODELS) {
      const config = buildCodexConfig(model.id, { modelSpec: model });
      const match = config.match(/model_reasoning_effort = "(.*)"/);
      expect(match, model.id).toBeDefined();
      expect(supportedEfforts.has(match![1]), `${model.id}: ${match![1]}`).toBe(true);
    }
  });

  it("maps the auto router to a pinned medium effort", () => {
    const auto = ZRO_MODELS.find((model) => model.id === "auto");
    const config = buildCodexConfig("auto", { modelSpec: auto });
    expect(config).toContain('model_reasoning_effort = "medium"');
  });

  it("clamps levels without codexEffort — the remote-catalog shape — via piLevel", () => {
    const remote = ZRO_MODELS.map((model) => ({
      ...model,
      reasoning: {
        ...model.reasoning,
        levels: model.reasoning.levels.map(({ codexEffort: _codexEffort, ...level }) => level)
      }
    }));
    for (const model of remote) {
      const config = buildCodexConfig(model.id, { modelSpec: model });
      const match = config.match(/model_reasoning_effort = "(.*)"/);
      expect(match, model.id).toBeDefined();
      expect(supportedEfforts.has(match![1]), `${model.id}: ${match![1]}`).toBe(true);
    }
    const glm = remote.find((model) => model.id === "glm-5.3");
    expect(buildCodexConfig("glm-5.3", { modelSpec: glm })).toContain('model_reasoning_effort = "xhigh"');
  });
});

describe("opencode emitter enables attachments for image-capable models", () => {
  const config = buildOpenCodeConfig(
    {},
    "sk-test",
    ZRO_MODELS,
    false,
  );
  const provider = config.provider as Record<string, Record<string, unknown>> | undefined;
  const providerModels = (provider?.zro?.models as Record<string, Record<string, unknown>> | undefined) ?? {};
  const models: Record<string, Record<string, unknown>> = providerModels;

  it("sets attachment + modalities on vision models", () => {
    for (const id of ["glm-5.3-flash", "deepseek-v4.1-flash", "dolly1-security", "kimi-k3"]) {
      expect(models[id]?.attachment).toBe(true);
      expect(models[id]?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    }
  });

  it("does not advertise attachment for text-only models", () => {
    expect(models["glm-5.3"]?.attachment).toBe(false);
    expect(models["glm-5.3"]?.modalities).toEqual({ input: ["text"], output: ["text"] });
  });

  it("still honors the kimi-k3 bundled vision flag", () => {
    expect(models["kimi-k3"]?.attachment).toBe(true);
    expect(models["kimi-k3"]?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
  });
});