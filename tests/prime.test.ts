import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { primeTool } from "../src/engine/tools/prime.js";
import { TEST_MODELS } from "./fixtures.js";
import type { LaunchContext } from "../src/engine/types.js";

describe("prime agent launch", () => {
  it("writes the current settings.json MCP format without the removed --extension flag", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-prime-settings-"));
    const plan = await primeTool.launch(context(home));

    expect(plan.args).not.toContain("--extension");
    const settings = plan.files?.find((file) => file.path.endsWith("settings.json"));
    expect(settings).toBeDefined();
    expect(JSON.parse(String(settings?.contents))).toEqual({
      mcpServers: {
        zro: {
          type: "http",
          url: "https://zro.moonmath.ai/mcp/zro",
          bearer_token_env_var: "ZRO_API_KEY"
        }
      }
    });
    expect(plan.files?.some((file) => file.path.endsWith("mcp.json"))).toBe(false);
  });
});

function context(homeDir: string): LaunchContext {
  return {
    apiKey: "sk-prime-secret",
    apiKeySource: "env",
    env: {},
    model: "glm-5.3",
    models: TEST_MODELS,
    extraArgs: [],
    homeDir,
    cwd: homeDir,
    tempDir: path.join(homeDir, "session"),
    platform: "linux",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough()
  };
}
