import { describe, it, expect } from "vitest";
import {
  buildContinueEntry,
  mergeContinueJson,
  mergeContinueYaml,
  buildRooProfile,
  buildClineProfileInstructions,
  buildVscodeLmGuide,
} from "../src/extensions.js";
import { BASE_URL } from "../src/constants.js";
import type { ZroModel } from "../src/constants.js";

const MODEL: ZroModel = {
  id: "glm-5.2",
  displayName: "GLM-5.2",
  contextWindow: 524288,
  maxOutputTokens: 64000,
};

const API_KEY = "sk-test-1234";

describe("buildContinueEntry", () => {
  it("produces an openai-provider entry pointing at the ZRO base URL", () => {
    const entry = buildContinueEntry(MODEL, API_KEY);
    expect(entry.name).toBe("ZRO GLM-5.2");
    expect(entry.provider).toBe("openai");
    expect(entry.model).toBe("glm-5.2");
    expect(entry.apiBase).toBe(BASE_URL);
    expect(entry.apiKey).toBe(API_KEY);
    expect(entry.roles).toEqual(["chat"]);
  });

  it("carries context-length and max-tokens into completion options", () => {
    const entry = buildContinueEntry(MODEL, API_KEY);
    const opts = entry.defaultCompletionOptions as { contextLength: number; maxTokens: number };
    expect(opts.contextLength).toBe(MODEL.contextWindow);
    expect(opts.maxTokens).toBe(MODEL.maxOutputTokens);
  });
});

describe("mergeContinueJson", () => {
  it("replaces an existing ZRO entry and preserves others", () => {
    const existing = JSON.stringify({
      models: [
        { name: "GPT-4o", provider: "openai", model: "gpt-4o" },
        { name: "ZRO GLM-5.2", provider: "openai", model: "old-id", apiKey: "old" },
      ],
    });
    const merged = mergeContinueJson(existing, [buildContinueEntry(MODEL, API_KEY)]);
    const parsed = JSON.parse(merged);
    const names = (parsed.models as Array<{ name: string }>).map((m) => m.name);
    expect(names).toEqual(["GPT-4o", "ZRO GLM-5.2"]);
    const zro = (parsed.models as Array<Record<string, unknown>>).find((m) => m.name === "ZRO GLM-5.2")!;
    expect(zro.model).toBe("glm-5.2");
    expect(zro.apiKey).toBe(API_KEY);
  });

  it("appends when no ZRO entry exists", () => {
    const existing = JSON.stringify({ models: [{ name: "GPT-4o", provider: "openai" }] });
    const merged = mergeContinueJson(existing, [buildContinueEntry(MODEL, API_KEY)]);
    const parsed = JSON.parse(merged);
    expect((parsed.models as unknown[]).length).toBe(2);
  });

  it("handles a missing models array", () => {
    const merged = mergeContinueJson("{}", [buildContinueEntry(MODEL, API_KEY)]);
    const parsed = JSON.parse(merged);
    expect((parsed.models as unknown[]).length).toBe(1);
  });

  it("handles unparseable existing text gracefully", () => {
    const merged = mergeContinueJson("not json", [buildContinueEntry(MODEL, API_KEY)]);
    const parsed = JSON.parse(merged);
    expect((parsed.models as unknown[]).length).toBe(1);
  });
});

describe("mergeContinueYaml", () => {
  it("replaces an existing ZRO entry and preserves others", () => {
    const existing = [
      "models:",
      "  - name: GPT-4o",
      "    provider: openai",
      "    model: gpt-4o",
      "  - name: ZRO GLM-5.2",
      "    provider: openai",
      "    model: old-id",
      "    apiKey: old",
      "    roles:",
      "      - chat",
      "",
    ].join("\n");
    const merged = mergeContinueYaml(existing, [buildContinueEntry(MODEL, API_KEY)]);
    // `ZRO GLM-5.2` contains a space, so the YAML writer quotes the name.
    const zroCount = (merged.match(/ZRO GLM-5\.2/g) ?? []).length;
    expect(zroCount).toBe(1);
    expect(merged).toContain("model: glm-5.2");
    expect(merged).toContain("name: GPT-4o");
    // The old entry is gone.
    expect(merged).not.toContain("old-id");
  });

  it("appends when no ZRO entry exists", () => {
    const existing = ["models:", "  - name: GPT-4o", "    provider: openai", ""].join("\n");
    const merged = mergeContinueYaml(existing, [buildContinueEntry(MODEL, API_KEY)]);
    expect(merged).toContain("name: GPT-4o");
    expect(merged).toContain("ZRO GLM-5.2");
  });

  it("appends a models: list when none exists", () => {
    const merged = mergeContinueYaml("foo: bar\n", [buildContinueEntry(MODEL, API_KEY)]);
    expect(merged).toContain("models:");
    expect(merged).toContain("foo: bar");
    expect(merged).toContain("ZRO GLM-5.2");
  });
});

describe("buildRooProfile", () => {
  it("builds an openai-provider profile with the ZRO base URL and key", () => {
    const profile = buildRooProfile(MODEL, API_KEY);
    expect(profile.currentApiConfigName).toBe("ZRO");
    const configs = profile.apiConfigs as Record<string, Record<string, unknown>>;
    const zro = configs.ZRO;
    expect(zro.apiProvider).toBe("openai");
    expect(zro.openAiBaseUrl).toBe(BASE_URL);
    expect(zro.openAiApiKey).toBe(API_KEY);
    expect(zro.openAiModelId).toBe("glm-5.2");
    expect(typeof zro.id).toBe("string");
    expect((zro.id as string).length).toBeGreaterThan(0);
  });
});

describe("buildClineProfileInstructions", () => {
  it("includes the openai-provider fields and human steps", () => {
    const { json, steps } = buildClineProfileInstructions(MODEL, API_KEY);
    expect(json.apiProvider).toBe("openai");
    expect(json.openAiBaseUrl).toBe(BASE_URL);
    expect(json.openAiApiKey).toBe(API_KEY);
    expect(json.openAiModelId).toBe("glm-5.2");
    expect(steps.some((s) => s.includes(BASE_URL))).toBe(true);
    expect(steps.some((s) => s.includes("glm-5.2"))).toBe(true);
  });
});

describe("buildVscodeLmGuide", () => {
  it("references the VS Code Language Model API provider and lists ZRO models", () => {
    const guide = buildVscodeLmGuide("cline", [MODEL]);
    expect(guide.title).toContain("Cline");
    expect(guide.steps.some((s) => s.includes("VS Code Language Model API"))).toBe(true);
    expect(guide.steps.some((s) => s.includes("ZRO GLM-5.2"))).toBe(true);
    expect(guide.steps.some((s) => s.includes("No API key"))).toBe(true);
  });

  it("uses the Roo settings command for the roo target", () => {
    const guide = buildVscodeLmGuide("roo", [MODEL]);
    expect(guide.steps.some((s) => s.includes("roo-cline.settingsButtonClicked"))).toBe(true);
  });

  it("uses the Cline settings command for the cline target", () => {
    const guide = buildVscodeLmGuide("cline", [MODEL]);
    expect(guide.steps.some((s) => s.includes("cline.settingsButtonClicked"))).toBe(true);
  });
});
