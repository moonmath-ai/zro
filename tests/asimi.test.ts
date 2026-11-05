import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { asimiTool, reasoningEffort } from "../src/engine/tools/asimi.js";
import type { LaunchContext } from "../src/engine/types.js";
import { TEST_MODELS, fakeSandboxBinDir } from "./fixtures.js";

describe("Asimi adapter", () => {
  it("launches via provider env conventions without writing config files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-asimi-home-"));
    const ctx = context(home, {
      PATH: await fakeSandboxBinDir(),
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.invalid",
    });
    const plan = await asimiTool.launch(ctx);

    expect(plan).toMatchObject({
      tool: "asimi",
      label: "Asimi",
      command: "asimi",
      model: "glm-5.3",
      args: ["--model", "glm-5.3", "--provider", "openai", "--print", "hello"],
    });
    expect(plan.files).toBeUndefined();
    expect(plan.env).toMatchObject({
      OPENAI_API_KEY: "sk-asimi-secret",
      OPENAI_BASE_URL: "https://zro.moonmath.ai/v1",
      ASIMI_PROVIDER: "openai",
      ASIMI_MODEL: "glm-5.3",
      ASIMI_REASONING_EFFORT: "high",
    });
    expect(Object.values(plan.env ?? {})).not.toContain("collector.invalid");
  });

  it("rejects the launch when podman or just is missing from PATH", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-asimi-home-"));
    const ctx = context(home, { PATH: "/nonexistent-zro-asimi" });
    await expect(asimiTool.launch(ctx)).rejects.toThrow(/podman/);
  });

  it("maps reasoning levels to asimi's low|medium|high efforts", () => {
    for (const model of TEST_MODELS) {
      const effort = reasoningEffort(model);
      expect(["low", "medium", "high", undefined]).toContain(effort);
    }
  });

  it("omits the reasoning effort when no level maps cleanly", async () => {
    const model = {
      ...TEST_MODELS[0],
      reasoning: {
        defaultLevel: "off",
        levels: [{ id: "off", description: "off", piLevel: "off" as const, openCodeOptions: {} }],
      },
    };
    expect(reasoningEffort(model)).toBeUndefined();
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-asimi-home-"));
    const ctx = context(home, { PATH: await fakeSandboxBinDir() });
    ctx.models = [model];
    const plan = await asimiTool.launch(ctx);
    expect(plan.env?.ASIMI_REASONING_EFFORT).toBeUndefined();
  });
});

function context(homeDir: string, env: NodeJS.ProcessEnv = {}): LaunchContext {
  return {
    apiKey: "sk-asimi-secret",
    apiKeySource: "env",
    inferenceRoot: "https://zro.moonmath.ai",
    inferenceBaseUrl: "https://zro.moonmath.ai/v1",
    mcpUrl: "https://zro.moonmath.ai/mcp/zro",
    noAuth: false,
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
