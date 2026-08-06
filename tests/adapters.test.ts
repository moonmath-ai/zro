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
      platform: "linux"
    });

    expect(code).toBe(0);
    const text = await streamText(stdout);
    const plan = JSON.parse(text) as {
      tool: string;
      command: string;
      model: string;
      environment: Record<string, string>;
    };
    expect(plan).toMatchObject({ tool, command: executable, model: "minimax-m3" });
    expect(text).not.toContain("sk-adapter-secret");
  });
});

async function streamText(stream: PassThrough): Promise<string> {
  stream.end();
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}
