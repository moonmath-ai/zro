import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { BASE_URL, PROVIDER_ID, ZRO_ENV_KEY } from "../src/engine/constants.js";
import { asimiTool, reasoningEffort } from "../src/engine/tools/asimi.js";
import type { LaunchContext } from "../src/engine/types.js";
import { TEST_MODELS } from "./fixtures.js";

describe("Asimi adapter", () => {
  it("launches via provider env conventions without writing config files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-asimi-home-"));
    const ctx = context(home, {
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.invalid",
    });
    const plan = await asimiTool.launch(ctx);

    expect(plan).toMatchObject({
      tool: "asimi",
      label: "Asimi",
      command: "asimi",
      model: "glm-5.3-flash",
      args: ["--model", "glm-5.3-flash", "--provider", PROVIDER_ID, "--print", "hello"],
    });
    expect(plan.files).toBeUndefined();
    expect(plan.env).toMatchObject({
      [ZRO_ENV_KEY]: "sk-asimi-secret",
      ZRO_BASE_URL: BASE_URL,
      ASIMI_PROVIDER: PROVIDER_ID,
      ASIMI_MODEL: "glm-5.3-flash",
      ASIMI_REASONING_EFFORT: expect.any(String),
    });
    expect(Object.values(plan.env ?? {})).not.toContain("collector.invalid");
  });

  it("maps reasoning levels to asimi's low|medium|high efforts", () => {
    for (const model of TEST_MODELS) {
      const effort = reasoningEffort(model);
      expect(["low", "medium", "high", undefined]).toContain(effort);
    }
  });

  it("omits the reasoning effort when no level maps cleanly", () => {
    const model = {
      ...TEST_MODELS[0],
      reasoning: {
        defaultLevel: "off",
        levels: [{ id: "off", description: "off", piLevel: "off" as const, openCodeOptions: {} }],
      },
    };
    expect(reasoningEffort(model)).toBeUndefined();
    const ctx = context(os.tmpdir());
    ctx.models = [model];
    return asimiTool.launch(ctx).then((plan) => {
      expect(plan.env?.ASIMI_REASONING_EFFORT).toBeUndefined();
    });
  });
});

function context(homeDir: string, env: NodeJS.ProcessEnv = {}): LaunchContext {
  return {
    apiKey: "sk-asimi-secret",
    apiKeySource: "env",
    env,
    model: "glm-5.3",
    models: TEST_MODELS,
    extraArgs: ["--print", "hello"],
    homeDir,
    cwd: homeDir,
    tempDir: path.join(homeDir, "session"),
    platform: "linux",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}
