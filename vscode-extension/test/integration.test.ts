import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildRequestBody, applyReasoningEffort } from "../src/provider.js";
import { parseReasoning } from "../src/catalog.js";
import { CONFIG_SECTION, SETTING_REASONING_EFFORT, SETTING_REASONING_EFFORT_BY_MODEL } from "../src/constants.js";
import { __setConfig, __resetConfig } from "./mocks/vscode.js";
import type { LanguageModelChatInformation } from "vscode";

/**
 * End-to-end check against a real catalog response captured from the control
 * plane (scripts/capture-log.jsonl). The unit tests use hand-written fixtures;
 * this one proves the shipped parsing + resolution + request-building pipeline
 * works on production data — including the exact `reasoning_effort` values that
 * will hit the wire.
 */

function realCatalog(): { default: string; models: Array<Record<string, unknown>> } {
  const lines = readFileSync(new URL("../scripts/capture-log.jsonl", import.meta.url), "utf8").split("\n");
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as { response?: { body_json?: { meta?: unknown; models?: unknown[] } } };
      const body = record.response?.body_json;
      if (body && Array.isArray(body.models) && body.models.length > 0) {
        return body as { default: string; models: Array<Record<string, unknown>> };
      }
    } catch {
      // Skip non-JSON / partial lines.
    }
  }
  throw new Error("No catalog response found in capture-log.jsonl");
}

// Raw catalog entries, with `reasoning` normalised the way fetchModelCatalog does.
const raw = realCatalog();
const models = raw.models.map((model) => ({
  id: model.id as string,
  displayName: model.displayName as string,
  reasoning: parseReasoning(model.reasoning as never),
}));

const glm = models.find((model) => model.id === "glm-5.2");
if (!glm) throw new Error("glm-5.2 missing from the captured catalog");

function info(id: string): LanguageModelChatInformation {
  return {
    id,
    name: `ZRO ${id}`,
    family: `zro-${id}`,
    version: "1.0.0",
    maxInputTokens: 400_000,
    maxOutputTokens: 64_000,
    capabilities: { toolCalling: true, imageInput: false },
  } as LanguageModelChatInformation;
}

/** Build the request exactly as ZroModelProvider does. */
function requestBody(id: string, reasoning: typeof glm.reasoning): Record<string, unknown> {
  const body = buildRequestBody(info(id), [], {});
  applyReasoningEffort(body, reasoning);
  return body;
}

beforeEach(() => {
  __resetConfig();
});

describe("real catalog integration", () => {
  it("extracts reasoning levels for every published model", () => {
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      // The control plane guarantees reasoning on every model (the CLI's
      // parseModelCatalog throws otherwise), so none should come back empty.
      expect(model.reasoning, `${model.id} has no reasoning`).toBeDefined();
      expect(model.reasoning!.levels.length).toBeGreaterThan(0);
      const ids = model.reasoning!.levels.map((level) => level.id);
      expect(ids).toContain(model.reasoning!.defaultLevel);
    }
  });

  it("matches the published default levels", () => {
    const byId = Object.fromEntries(models.map((model) => [model.id, model.reasoning!.defaultLevel]));
    expect(byId["glm-5.2"]).toBe("max");
    expect(byId["kimi-k3"]).toBe("high");
  });

  it("omits reasoning_effort when unconfigured", () => {
    const body = requestBody("glm-5.2", glm.reasoning);
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.model).toBe("glm-5.2");
    expect(body.stream).toBe(true);
  });

  it("sends the configured level as reasoning_effort", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "high" });
    expect(requestBody("glm-5.2", glm.reasoning).reasoning_effort).toBe("high");
  });

  it("honours a per-model override over the global setting", () => {
    __setConfig(CONFIG_SECTION, {
      [SETTING_REASONING_EFFORT]: "high",
      [SETTING_REASONING_EFFORT_BY_MODEL]: { "glm-5.2": "none" },
    });
    const body = requestBody("glm-5.2", glm.reasoning);
    expect(body.reasoning_effort).toBe("none");
  });

  it("clamps an unsupported level to the model default", () => {
    // GLM publishes none/high/max — "low" is not among them.
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "low" });
    expect(requestBody("glm-5.2", glm.reasoning).reasoning_effort).toBe("max");
  });

  it("only emits levels the model actually advertises", () => {
    for (const model of models) {
      const advertised = new Set(model.reasoning!.levels.map((level) => level.id));
      for (const configured of ["none", "low", "high", "max"]) {
        __resetConfig();
        __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: configured });
        const sent = requestBody(model.id, model.reasoning).reasoning_effort;
        if (sent !== undefined) {
          expect(advertised.has(sent as string), `${model.id} would send unadvertised "${sent}"`).toBe(true);
        }
      }
    }
  });

  it("leaves a model with no reasoning block untouched", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: "max" });
    const body = requestBody("plain-model", undefined);
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});