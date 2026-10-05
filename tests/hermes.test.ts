import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { TIER_MODELS } from "./fixtures.js";
import { yamlSerializer } from "../src/engine/serializers.js";
import { hermesTool } from "../src/engine/tools/hermes.js";
import type { LaunchContext } from "../src/engine/types.js";

describe("Hermes adapter", () => {
  it("caps launch output at the selected model's catalog max output tokens", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-hermes-output-"));
    const plan = await hermesTool.launch(context(home, "glm-5.3"));
    const config = yamlSerializer.parse(plan.files![0].contents) as Record<string, unknown>;
    const modelSection = config.model as Record<string, unknown>;
    expect(modelSection.max_tokens).toBe(131000);
    expect(modelSection.default_headers).toMatchObject({ "User-Agent": "hermes" });
  });

  it("overwrites a user's existing model.max_tokens for known selections", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-hermes-overwrite-"));
    const hermesDir = path.join(home, ".hermes");
    await fs.mkdir(hermesDir, { recursive: true });
    await fs.writeFile(
      path.join(hermesDir, "config.yaml"),
      yamlSerializer.stringify({ model: { max_tokens: 777 } })
    );

    const plan = await hermesTool.launch(context(home, "glm-5.3"));
    const config = yamlSerializer.parse(plan.files![0].contents) as Record<string, unknown>;
    expect((config.model as Record<string, unknown>).max_tokens).toBe(131000);
  });

  it("preserves a user's own model.max_tokens for unknown selections", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-hermes-untouched-"));
    const hermesDir = path.join(home, ".hermes");
    await fs.mkdir(hermesDir, { recursive: true });
    await fs.writeFile(
      path.join(hermesDir, "config.yaml"),
      yamlSerializer.stringify({ model: { max_tokens: 777 } })
    );

    const plan = await hermesTool.launch(context(home, "not-in-catalog"));
    const config = yamlSerializer.parse(plan.files![0].contents) as Record<string, unknown>;
    expect((config.model as Record<string, unknown>).max_tokens).toBe(777);
  });
});

function context(homeDir: string, model: string): LaunchContext {
  return {
    apiKey: "sk-hermes-secret",
    apiKeySource: "env",
    env: {},
    model,
    models: TIER_MODELS,
    extraArgs: [],
    homeDir,
    cwd: homeDir,
    tempDir: path.join(homeDir, "session"),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough()
  };
}
