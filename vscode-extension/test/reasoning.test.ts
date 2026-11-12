import { describe, it, expect, beforeEach } from "vitest";
import {
  parseReasoning,
  fetchModelCatalog,
} from "../src/catalog.js";
import {
  readEffortSettings,
  resolveEffort,
  effortForRequest,
  setEffort,
  effortLabel,
  buildReasoningConfigurationSchema,
  effortFromModelConfiguration,
  levelLabel,
} from "../src/reasoning.js";
import {
  CONFIG_SECTION,
  EFFORT_DEFAULT,
  SETTING_REASONING_EFFORT,
  SETTING_REASONING_EFFORT_BY_MODEL,
  type ZroReasoningConfig,
} from "../src/constants.js";
import { __setConfig, __resetConfig } from "./mocks/vscode.js";

const GLM: ZroReasoningConfig = {
  defaultLevel: "max",
  levels: [
    { id: "none", description: "Disable reasoning for the lowest latency" },
    { id: "high", description: "Use GLM High reasoning effort" },
    { id: "max", description: "Use GLM maximum reasoning effort" },
  ],
};

const KIMI: ZroReasoningConfig = {
  defaultLevel: "high",
  levels: [
    { id: "low", description: "Use Kimi low reasoning effort" },
    { id: "high", description: "Use Kimi high reasoning effort" },
    { id: "max", description: "Use Kimi maximum reasoning effort" },
  ],
};

beforeEach(() => {
  __resetConfig();
});

describe("parseReasoning", () => {
  it("keeps valid level ids and descriptions", () => {
    expect(
      parseReasoning({
        defaultLevel: "max",
        levels: [
          { id: "none", description: "off" },
          { id: "max", description: "top" },
        ],
      })
    ).toEqual({
      defaultLevel: "max",
      levels: [
        { id: "none", description: "off" },
        { id: "max", description: "top" },
      ],
    });
  });

  it("drops levels without an id", () => {
    const parsed = parseReasoning({
      defaultLevel: "high",
      levels: [{ description: "no id" }, { id: "high", description: "ok" }, { id: "" }],
    });
    expect(parsed?.levels).toEqual([{ id: "high", description: "ok" }]);
  });

  it("falls back to the id when description is missing or empty", () => {
    const parsed = parseReasoning({ defaultLevel: "low", levels: [{ id: "low" }, { id: "high", description: "" }] });
    expect(parsed?.levels).toEqual([
      { id: "low", description: "low" },
      { id: "high", description: "high" },
    ]);
  });

  it("falls back to the first level when defaultLevel is absent or unknown", () => {
    expect(parseReasoning({ levels: [{ id: "a" }, { id: "b" }] })?.defaultLevel).toBe("a");
    expect(parseReasoning({ defaultLevel: "nope", levels: [{ id: "a" }] })?.defaultLevel).toBe("a");
  });

  it("returns undefined when no usable levels survive", () => {
    expect(parseReasoning(undefined)).toBeUndefined();
    expect(parseReasoning({ defaultLevel: "max" })).toBeUndefined();
    expect(parseReasoning({ levels: [] })).toBeUndefined();
  });
});

describe("fetchModelCatalog reasoning", () => {
  it("carries reasoning through, and tolerates models without it", async () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error - test harness replaces global fetch
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          default: "glm-5.2",
          models: [
            {
              id: "glm-5.2",
              displayName: "GLM-5.2",
              reasoning: { defaultLevel: "max", levels: [{ id: "none" }, { id: "max" }] },
            },
            { id: "plain-model", displayName: "Plain" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    try {
      const { models } = await fetchModelCatalog("sk-test");
      expect(models[0].reasoning?.defaultLevel).toBe("max");
      expect(models[0].reasoning?.levels.map((l) => l.id)).toEqual(["none", "max"]);
      // A model with no reasoning block stays reachable but exposes no levels.
      expect(models[1].reasoning).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("levelLabel", () => {
  it("spells out `none` and capitalizes the rest", () => {
    expect(levelLabel("none")).toBe("No thinking");
    expect(levelLabel("high")).toBe("High");
    expect(levelLabel("xhigh")).toBe("Xhigh");
  });
});

describe("buildReasoningConfigurationSchema", () => {
  it("builds the in-picker thinking-effort schema from the model's levels", () => {
    expect(buildReasoningConfigurationSchema(GLM)).toEqual({
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["none", "high", "max"],
          enumItemLabels: ["No thinking", "High", "Max"],
          enumDescriptions: [
            "Disable reasoning for the lowest latency",
            "Use GLM High reasoning effort",
            "Use GLM maximum reasoning effort",
          ],
          default: "max",
          group: "navigation",
        },
      },
    });
  });

  it("returns undefined without levels", () => {
    expect(buildReasoningConfigurationSchema(undefined)).toBeUndefined();
    expect(buildReasoningConfigurationSchema({ defaultLevel: "max", levels: [] })).toBeUndefined();
  });
});

describe("effortFromModelConfiguration", () => {
  it("returns the selected level when the model advertises it", () => {
    expect(effortFromModelConfiguration({ reasoningEffort: "high" }, GLM)).toBe("high");
  });

  it("rejects values the model does not advertise", () => {
    expect(effortFromModelConfiguration({ reasoningEffort: "xhigh" }, GLM)).toBeNull();
  });

  it("ignores missing or malformed configuration", () => {
    expect(effortFromModelConfiguration(undefined, GLM)).toBeNull();
    expect(effortFromModelConfiguration(null, GLM)).toBeNull();
    expect(effortFromModelConfiguration({}, GLM)).toBeNull();
    expect(effortFromModelConfiguration({ reasoningEffort: 42 }, GLM)).toBeNull();
    expect(effortFromModelConfiguration("high", GLM)).toBeNull();
  });

  it("returns null for models without reasoning levels", () => {
    expect(effortFromModelConfiguration({ reasoningEffort: "high" }, undefined)).toBeNull();
  });
});

describe("readEffortSettings", () => {
  it("defaults to the DEFAULT sentinel and an empty override map", () => {
    expect(readEffortSettings()).toEqual({ global: EFFORT_DEFAULT, perModel: {} });
  });

  it("reads configured values", () => {
    __setConfig(CONFIG_SECTION, {
      [SETTING_REASONING_EFFORT]: "high",
      [SETTING_REASONING_EFFORT_BY_MODEL]: { "glm-5.2": "none" },
    });
    expect(readEffortSettings()).toEqual({ global: "high", perModel: { "glm-5.2": "none" } });
  });

  it("ignores a non-string global value", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: 42 });
    expect(readEffortSettings().global).toBe(EFFORT_DEFAULT);
  });
});

describe("resolveEffort", () => {
  it("returns no level when nothing is configured, so the proxy default applies", () => {
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: null, source: "server" });
  });

  it("uses the global setting when no override exists", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "high" });
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: "high", source: "global" });
  });

  it("lets the per-model override win over the global setting", () => {
    __setConfig(CONFIG_SECTION, {
      [SETTING_REASONING_EFFORT]: "high",
      [SETTING_REASONING_EFFORT_BY_MODEL]: { "glm-5.2": "none" },
    });
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: "none", source: "model" });
    // A different model keeps falling back to the global value.
    expect(resolveEffort("kimi-k3", KIMI)).toEqual({ level: "high", source: "global" });
  });

  it("treats an explicit 'default' override as unset and falls through to global", () => {
    __setConfig(CONFIG_SECTION, {
      [SETTING_REASONING_EFFORT]: "max",
      [SETTING_REASONING_EFFORT_BY_MODEL]: { "glm-5.2": EFFORT_DEFAULT },
    });
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: "max", source: "global" });
  });

  it("falls back to the model default when the configured level is unsupported", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "low" });
    // GLM has no "low" level.
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: "max", source: "global" });
  });

  it("maps alias vocabularies onto the model's own levels", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "off" });
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: "none", source: "global" });

    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "disabled" });
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: "none", source: "global" });

    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "enabled" });
    expect(resolveEffort("glm-5.2", GLM)).toEqual({ level: "max", source: "global" });
  });

  it("returns no level for a model with no reasoning levels", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "high" });
    expect(resolveEffort("minimax-m3", undefined)).toEqual({ level: null, source: "server" });
  });

  it("accepts explicit settings, bypassing the configuration store", () => {
    expect(resolveEffort("glm-5.2", GLM, { global: "none", perModel: {} })).toEqual({
      level: "none",
      source: "global",
    });
  });
});

describe("effortForRequest", () => {
  it("omits the level when unset", () => {
    expect(effortForRequest("glm-5.2", GLM)).toBeNull();
  });

  it("returns the configured level", () => {
    __setConfig(CONFIG_SECTION, {
      [SETTING_REASONING_EFFORT_BY_MODEL]: { "kimi-k3": "low" },
    });
    expect(effortForRequest("kimi-k3", KIMI)).toBe("low");
  });

  it("returns null for a model without levels even when configured", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "max" });
    expect(effortForRequest("minimax-m3", undefined)).toBeNull();
  });
});

describe("setEffort", () => {
  it("writes a per-model override", async () => {
    await setEffort("glm-5.2", "high");
    expect(readEffortSettings().perModel).toEqual({ "glm-5.2": "high" });
  });

  it("preserves other models' overrides", async () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT_BY_MODEL]: { "kimi-k3": "low" } });
    await setEffort("glm-5.2", "high");
    expect(readEffortSettings().perModel).toEqual({ "kimi-k3": "low", "glm-5.2": "high" });
  });

  it("clears a per-model override when set back to default", async () => {
    await setEffort("glm-5.2", "high");
    await setEffort("glm-5.2", EFFORT_DEFAULT);
    expect(readEffortSettings().perModel).toEqual({});
  });

  it("writes and clears the global setting", async () => {
    await setEffort(null, "high");
    expect(readEffortSettings().global).toBe("high");
    await setEffort(null, EFFORT_DEFAULT);
    expect(readEffortSettings().global).toBe(EFFORT_DEFAULT);
  });

  it("keeps global and per-model scopes independent", async () => {
    await setEffort(null, "max");
    await setEffort("glm-5.2", "none");
    const settings = readEffortSettings();
    expect(settings.global).toBe("max");
    expect(settings.perModel).toEqual({ "glm-5.2": "none" });
  });
});

describe("effortLabel", () => {
  const model = (id: string, reasoning?: ZroReasoningConfig) => ({
    id,
    displayName: id,
    contextWindow: 1000,
    maxOutputTokens: 100,
    reasoning,
  });

  it("labels the server default", () => {
    expect(effortLabel(model("glm-5.2", GLM))).toBe("max (server default)");
  });

  it("labels the source of the resolved value", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "high" });
    expect(effortLabel(model("glm-5.2", GLM))).toBe("high (global)");

    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT_BY_MODEL]: { "glm-5.2": "none" } });
    expect(effortLabel(model("glm-5.2", GLM))).toBe("none (per-model)");
  });

  it("labels a model with no levels as default", () => {
    expect(effortLabel(model("minimax-m3"))).toBe("default (server default)");
  });
});