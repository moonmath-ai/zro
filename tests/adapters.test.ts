import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";

const adapters = [
  ["claude", "claude"],
  ["codex", "codex"],
  ["codex-app", "codex"],
  ["grok", "grok"],
  ["hermes", "hermes"],
  ["kilo", "kilo"],
  ["omp", "omp"],
  ["openclaw", "openclaw"],
  ["opencode", "opencode"],
  ["pi", "pi"],
  ["prime", "prime-agent"]
] as const;

describe("tool adapters", () => {
  it.each(adapters)("builds a secret-safe %s session plan", async (tool, executable) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), `zro-${tool}-`));
    const stdout = new PassThrough();
    const code = await run([tool, "--json"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: { ZRO_API_KEY: "sk-adapter-secret", XDG_CONFIG_HOME: path.join(home, ".config") },
      platform: "linux",
      fetch: async (input) => String(input).endsWith("/api/cli/models")
        ? Response.json(defaultCatalogResponse())
        : new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const text = await streamText(stdout);
    const plan = JSON.parse(text) as {
      tool: string;
      command: string;
      model: string;
      environment: Record<string, string>;
    };
    expect(plan).toMatchObject({ tool, command: executable, model: "glm-5.2" });
    expect(text).not.toContain("sk-adapter-secret");
  });
});

async function streamText(stream: PassThrough): Promise<string> {
  stream.end();
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}

function defaultCatalogResponse() {
  return {
    version: 1,
    default: "glm-5.2",
    models: [
      {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        contextWindow: 524_288,
        maxOutputTokens: 64_000,
        modalities: { input: ["text"], output: ["text"] },
        reasoning: {
          defaultLevel: "high",
          levels: [
            {
              id: "high",
              description: "Reason carefully",
              piLevel: "high",
              openCodeOptions: { reasoningEffort: "high" },
            },
          ],
        },
      },
    ],
  };
}
