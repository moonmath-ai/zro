import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { BASE_URL, MCP_URL, ZRO_ENV_KEY } from "../src/engine/constants.js";
import {
  buildNanocodexMcpConfig,
  NANOCODEX_FALLBACK_MODEL,
  nanocodexTool,
} from "../src/engine/tools/nanocodex.js";
import type { LaunchContext } from "../src/engine/types.js";
import { TEST_MODELS } from "./fixtures.js";

describe("Nanocodex adapter", () => {
  it("passes a native model through and points the Codex harness at Zro", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-nanocodex-home-"));
    const ctx = context(home, {
      OPENAI_API_KEY: "sk-nanocodex-stale",
    });
    const plan = await nanocodexTool.launch(ctx);

    expect(plan).toMatchObject({
      tool: "nanocodex",
      label: "Nanocodex",
      command: "nanocodex",
      model: "glm-5.3",
      args: ["--harness", "codex", "--model", "glm-5.3", "run", "hello"],
    });
    expect(plan.env).toMatchObject({
      OPENAI_API_KEY: "sk-nanocodex-secret",
      OPENAI_API_BASE_URL: BASE_URL,
      NANOCODEX_RESPONSES_TRANSPORT: "https",
      [ZRO_ENV_KEY]: "sk-nanocodex-secret",
    });
    expect(plan.env?.NANOCODEX_MODEL_ID_PREFIX).toBeUndefined();

    const config = plan.files?.find((file) => file.path.endsWith("config.toml"));
    expect(config).toBeDefined();
    expect(config?.path).toBe(path.join(ctx.tempDir, "nanocodex", "codex", "config.toml"));
    expect(config?.contents).toContain(MCP_URL);
    expect(config?.contents).toContain(`bearer_token_env_var = "${ZRO_ENV_KEY}"`);
    expect(String(config?.contents)).not.toContain("sk-nanocodex-secret");
  });

  it("routes a non-native model through the prefix with a compatible base slot", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-nanocodex-home-"));
    const ctx = context(home, {});
    ctx.model = "deepseek-v4.1-flash";

    const plan = await nanocodexTool.launch(ctx);

    expect(plan.model).toBe("deepseek-v4.1-flash");
    expect(plan.args).toEqual([
      "--harness",
      "codex",
      "--model",
      NANOCODEX_FALLBACK_MODEL,
      "run",
      "hello",
    ]);
    expect(plan.env?.NANOCODEX_MODEL_ID_PREFIX).toBe("deepseek-v4.1-flash");
  });

  it("writes a Codex-compatible MCP server that references the key by name", () => {
    expect(buildNanocodexMcpConfig()).toBe(
      [
        "[mcp_servers.zro]",
        `url = ${JSON.stringify(MCP_URL)}`,
        `bearer_token_env_var = ${JSON.stringify(ZRO_ENV_KEY)}`,
        "",
      ].join("\n"),
    );
  });
});

function context(homeDir: string, env: NodeJS.ProcessEnv = {}): LaunchContext {
  return {
    apiKey: "sk-nanocodex-secret",
    apiKeySource: "env",
    env,
    model: "glm-5.3",
    models: TEST_MODELS,
    extraArgs: ["run", "hello"],
    homeDir,
    cwd: homeDir,
    tempDir: path.join(homeDir, "session"),
    platform: "linux",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}
