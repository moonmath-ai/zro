import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { BASE_URL, MCP_URL } from "../src/engine/constants.js";
import { opencodeTool } from "../src/engine/tools/opencode.js";
import type { LaunchContext } from "../src/engine/types.js";
import { TEST_MODELS } from "./fixtures.js";

describe("OpenCode adapter", () => {
  it("copies safe user files but skips credentials, env files, and symlinks", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-opencode-home-"));
    const tempDir = path.join(home, "session");
    const userRoot = path.join(home, "config", "opencode");
    await fs.mkdir(path.join(userRoot, "agents"), { recursive: true });
    await fs.writeFile(path.join(userRoot, "agents", "helper.md"), "Helpful agent\n");
    await fs.writeFile(path.join(userRoot, "auth.json"), '{"token":"do-not-copy"}\n');
    await fs.writeFile(path.join(userRoot, "service.json"), '{"password":"do-not-copy"}\n');
    await fs.writeFile(path.join(userRoot, ".env"), "TOKEN=do-not-copy\n");
    const outside = path.join(home, "outside-secret.md");
    await fs.writeFile(outside, "do-not-copy-outside\n");
    if (process.platform !== "win32") {
      await fs.symlink(outside, path.join(userRoot, "agents", "linked.md"));
    }

    const plan = await opencodeTool.launch(
      context(home, tempDir, { XDG_CONFIG_HOME: path.join(home, "config") }),
    );

    expect(plan).toMatchObject({ tool: "opencode", command: "opencode", model: "glm-5.3" });
    expect(
      plan.files?.some((file) => file.path === path.join(tempDir, "xdg", "opencode", "agents", "helper.md")),
    ).toBe(true);
    for (const name of ["auth.json", "service.json", ".env", "linked.md"]) {
      expect(plan.files?.some((file) => path.basename(file.path) === name)).toBe(false);
    }
    const copied = (plan.files ?? [])
      .map((file) => typeof file.contents === "string" ? file.contents : Buffer.from(file.contents).toString())
      .join("\n");
    expect(copied).not.toContain("do-not-copy");
  });
});

function context(homeDir: string, tempDir: string, env: NodeJS.ProcessEnv = {}): LaunchContext {
  return {
    apiKey: "sk-opencode-secret",
    apiKeySource: "env",
    inferenceRoot: "https://zro.moonmath.ai",
    inferenceBaseUrl: BASE_URL,
    mcpUrl: MCP_URL,
    noAuth: false,
    env,
    model: "glm-5.3",
    models: TEST_MODELS,
    extraArgs: [],
    homeDir,
    cwd: homeDir,
    tempDir,
    platform: "linux",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}
