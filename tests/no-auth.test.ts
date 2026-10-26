import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { TEST_CATALOG_RESPONSE, TEST_MODELS } from "./fixtures.js";
import type { LaunchContext, SpawnOptions, SpawnProcess, ToolModule } from "../src/engine/types.js";
import { claudeTool } from "../src/engine/tools/claude.js";
import { codexAppTool, codexTool } from "../src/engine/tools/codex.js";
import { grokTool } from "../src/engine/tools/grok.js";
import { hermesTool } from "../src/engine/tools/hermes.js";
import { kiloTool } from "../src/engine/tools/kilo.js";
import { ompTool } from "../src/engine/tools/omp.js";
import { openClawTool } from "../src/engine/tools/openclaw.js";
import { opencodeTool } from "../src/engine/tools/opencode.js";
import { piTool } from "../src/engine/tools/pi.js";
import { primeTool } from "../src/engine/tools/prime.js";
import { run } from "../src/run.js";

const GATEWAY_ROOT = "https://gateway.example";
const GATEWAY_BASE_URL = `${GATEWAY_ROOT}/v1`;
const PUBLIC_CATALOG_URL = "https://zro.moonmath.ai/api/cli/models/public";

const tools: readonly ToolModule[] = [
  claudeTool,
  codexTool,
  codexAppTool,
  grokTool,
  hermesTool,
  kiloTool,
  ompTool,
  openClawTool,
  opencodeTool,
  piTool,
  primeTool,
];

describe("no-auth gateway mode", () => {
  it("launches against the gateway using only gateway-available public models", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-no-auth-launch-"));
    const calls: Array<{ url: string; authorization: string | null }> = [];

    const code = await run(["claude"], {
      ...io(home),
      env: {
        ZRO_NO_AUTH: "1",
        ZRO_INFERENCE_URL: `${GATEWAY_BASE_URL}/`,
      },
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
        if (url === PUBLIC_CATALOG_URL) return Response.json(TEST_CATALOG_RESPONSE);
        if (url === `${GATEWAY_BASE_URL}/models`) {
          return Response.json({ data: [{ id: "zro/kimi-k3" }] });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      spawn: fakeExitSpawn(() => {}),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { url: PUBLIC_CATALOG_URL, authorization: null },
      { url: `${GATEWAY_BASE_URL}/models`, authorization: null },
    ]);

    const cacheRoot = path.join(home, ".cache", "zro");
    const publicCache = JSON.parse(
      await fs.readFile(path.join(cacheRoot, "model-catalog-public.json"), "utf8"),
    ) as { default: string; models: Array<{ id: string }> };
    expect(publicCache.models.map((model) => model.id)).toEqual(["glm-5.3", "kimi-k3"]);
    await expect(fs.stat(path.join(cacheRoot, "model-catalog.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("filters the catalog down to models the gateway actually serves", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-no-auth-filter-"));
    const stdout = new PassThrough();

    const code = await run(["models", "--json"], {
      ...io(home),
      stdout,
      env: {
        ZRO_NO_AUTH: "1",
        ZRO_INFERENCE_URL: GATEWAY_BASE_URL,
      },
      fetch: async (input) => {
        const url = String(input);
        if (url === PUBLIC_CATALOG_URL) return Response.json(TEST_CATALOG_RESPONSE);
        if (url === `${GATEWAY_BASE_URL}/models`) {
          return Response.json({ data: [{ id: "zro/kimi-k3" }, { id: "retired-model" }] });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(code).toBe(0);
    const catalog = JSON.parse(await streamText(stdout));
    expect(catalog.source).toBe("remote");
    expect(catalog.default).toBe("kimi-k3");
    expect(catalog.models.map((model: { id: string }) => model.id)).toEqual(["kimi-k3"]);
  });

  it("shows the placeholder key in previews without exposing a secret", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-no-auth-preview-"));
    const stdout = new PassThrough();

    const code = await run(["claude", "--json"], {
      ...io(home),
      stdout,
      env: {
        ZRO_NO_AUTH: "1",
        ZRO_INFERENCE_URL: GATEWAY_BASE_URL,
      },
      fetch: async (input) => {
        const url = String(input);
        if (url === PUBLIC_CATALOG_URL) return Response.json(TEST_CATALOG_RESPONSE);
        if (url === `${GATEWAY_BASE_URL}/models`) {
          return Response.json({ data: [{ id: "zro/glm-5.3" }] });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(code).toBe(0);
    const preview = JSON.parse(await streamText(stdout));
    expect(preview.environment.ANTHROPIC_BASE_URL).toBe(GATEWAY_ROOT);
    expect(preview.environment.ANTHROPIC_AUTH_TOKEN).toBe("zro-no-auth");
    await expect(fs.stat(path.join(home, ".cache", "zro", "model-catalog-public.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("shows the gateway mode in status instead of not logged in", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-no-auth-status-"));
    const stdout = new PassThrough();

    const code = await run(["status"], {
      ...io(home),
      stdout,
      env: {
        ZRO_NO_AUTH: "1",
        ZRO_INFERENCE_URL: GATEWAY_BASE_URL,
      },
    });

    expect(code).toBe(0);
    const output = await streamText(stdout);
    expect(output).toContain("No-auth gateway mode");
    expect(output).toContain(GATEWAY_ROOT);
    expect(output).not.toContain("Not logged in");
  });

  it("rejects feedback in no-auth mode", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-no-auth-feedback-"));
    const stderr = new PassThrough();

    const code = await run(["feedback", "hello"], {
      ...io(home),
      stderr,
      env: {
        ZRO_NO_AUTH: "1",
        ZRO_INFERENCE_URL: GATEWAY_BASE_URL,
      },
    });

    expect(code).toBe(1);
    expect(await streamText(stderr)).toContain("unavailable in no-auth mode");
  });

  it("requires an explicit inference override for no-auth launches and models", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-no-auth-override-"));
    const launchStderr = new PassThrough();
    const modelsStderr = new PassThrough();

    const launchCode = await run(["claude"], {
      ...io(home),
      stderr: launchStderr,
      env: { ZRO_NO_AUTH: "1", ZRO_ENDPOINT_ROOT: "https://endpoint.example" },
    });
    const modelsCode = await run(["models"], {
      ...io(home),
      stderr: modelsStderr,
      env: { ZRO_NO_AUTH: "1", ZRO_ENDPOINT_ROOT: "https://endpoint.example" },
    });

    expect(launchCode).toBe(1);
    expect(modelsCode).toBe(1);
    expect(await streamText(launchStderr)).toContain("No-auth mode needs an inference URL");
    expect(await streamText(modelsStderr)).toContain("No-auth mode needs an inference URL");
  });

  it.each(tools.map((tool) => [tool.id, tool] as const))(
    "points %s at the gateway and omits the Zro MCP server",
    async (_id, tool) => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), `zro-no-auth-${tool.id}-`));
      const plan = await tool.launch(context(home));

      if (tool.id === "claude") {
        expect(plan.env?.ANTHROPIC_BASE_URL).toBe(GATEWAY_ROOT);
        expect(plan.env?.ANTHROPIC_AUTH_TOKEN).toBe("zro-no-auth");
        expect(plan.args).not.toContain("--mcp-config");
      } else {
        expect(plan.env?.ZRO_API_KEY).toBe("zro-no-auth");
      }

      const files = (plan.files ?? []).map((file) => String(file.contents)).join("\n");
      const envText = JSON.stringify(plan.env);
      if (tool.id !== "claude") expect(files + envText).toContain(GATEWAY_BASE_URL);
      expect(files + envText).not.toContain("/mcp/zro");
      expect(files + envText).not.toContain("Authorization");
    },
  );
});

function context(homeDir: string): LaunchContext {
  return {
    apiKey: "zro-no-auth",
    apiKeySource: "none",
    inferenceRoot: GATEWAY_ROOT,
    inferenceBaseUrl: GATEWAY_BASE_URL,
    mcpUrl: "https://zro.moonmath.ai/mcp/zro",
    noAuth: true,
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
    stderr: new PassThrough(),
  };
}

function io(home: string) {
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    homeDir: home,
    cwd: home,
    env: {},
    platform: "linux" as const,
    version: "0.0.1",
  };
}

function fakeExitSpawn(assertion: (command: string, args: string[], options: SpawnOptions) => void): SpawnProcess {
  return ((command: string, args: string[], options: SpawnOptions) => {
    assertion(command, args, options);
    const child = new EventEmitter() as ChildProcess;
    queueMicrotask(() => child.emit("exit", 0, null));
    return child;
  }) as SpawnProcess;
}

async function streamText(stream: PassThrough): Promise<string> {
  stream.end();
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}
