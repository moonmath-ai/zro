import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { buildRequestBody, applyReasoningEffort } from "../src/provider.js";
import { parseReasoning } from "../src/catalog.js";
import {
  CONFIG_SECTION,
  SETTING_REASONING_EFFORT,
  SETTING_REASONING_EFFORT_BY_MODEL,
  type ZroReasoningConfig,
} from "../src/constants.js";
import { __setConfig, __resetConfig } from "./mocks/vscode.js";
import type { LanguageModelChatInformation } from "vscode";

/**
 * End-to-end check against a real catalog response captured from the control
 * plane (scripts/capture-log.jsonl). The unit tests use hand-written fixtures;
 * this one proves the shipped parsing + resolution + request-building pipeline
 * works on production data — including the exact `reasoning_effort` values that
 * will hit the wire.
 *
 * The capture is a local dev artifact written by `scripts/capture-proxy.py` and
 * is not committed, so the suite skips itself when it is absent instead of
 * failing on every clean checkout.
 */
const CAPTURE = new URL("../scripts/capture-log.jsonl", import.meta.url);
const hasCapture = existsSync(CAPTURE);

function realCatalog(): { default: string; models: Array<Record<string, unknown>> } {
  const lines = readFileSync(CAPTURE, "utf8").split("\n");
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
const models = (hasCapture ? realCatalog().models : []).map((model) => ({
  id: model.id as string,
  displayName: model.displayName as string,
  reasoning: parseReasoning(model.reasoning as never),
}));

/**
 * The model the request-building tests exercise. Deliberately not pinned to a
 * specific id: the capture is a point-in-time snapshot, so the models it
 * contains — and their level sets — change as the catalog does.
 */
const subject = models.find((model) => model.reasoning?.levels.length) ?? models[0];
const levels = subject?.reasoning?.levels.map((level) => level.id) ?? [];
const levelA = levels[0];
const levelB = levels.find((level) => level !== levelA);
const unsupportedLevel = ["none", "minimal", "low", "medium", "high", "xhigh", "max"].find(
  (candidate) => !levels.includes(candidate)
);

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
function requestBody(id: string, reasoning: ZroReasoningConfig | undefined): Record<string, unknown> {
  const body = buildRequestBody(info(id), [], {});
  applyReasoningEffort(body, reasoning);
  return body;
}

beforeEach(() => {
  __resetConfig();
});

// Skip the whole suite when the capture is absent. A conditional at the call
// site reads the same on every vitest version, unlike `describe.skipIf`.
const suite = hasCapture ? describe : describe.skip;

suite("real catalog integration", () => {
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

  it("omits reasoning_effort when unconfigured", () => {
    const body = requestBody(subject.id, subject.reasoning);
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.model).toBe(subject.id);
    expect(body.stream).toBe(true);
  });

  it("sends the configured level as reasoning_effort", () => {
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: levelA });
    expect(requestBody(subject.id, subject.reasoning).reasoning_effort).toBe(levelA);
  });

  // Needs two distinct levels on the same model to tell the two scopes apart.
  const overrideCase = levelB ? it : it.skip;
  overrideCase("honours a per-model override over the global setting", () => {
    __setConfig(CONFIG_SECTION, {
      [SETTING_REASONING_EFFORT]: levelA,
      [SETTING_REASONING_EFFORT_BY_MODEL]: { [subject.id]: levelB },
    });
    expect(requestBody(subject.id, subject.reasoning).reasoning_effort).toBe(levelB);
  });

  const clampCase = unsupportedLevel ? it : it.skip;
  clampCase("clamps an unsupported level to the model default", () => {
    // `subject` publishes its own level set, which does not contain this one.
    __setConfig(CONFIG_SECTION, { [SETTING_REASONING_EFFORT]: unsupportedLevel });
    expect(requestBody(subject.id, subject.reasoning).reasoning_effort).toBe(
      subject.reasoning!.defaultLevel
    );
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