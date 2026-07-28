import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import type { SpawnProcess } from "../src/types.js";

function recorder(exitCode = 0): {
  spawn: SpawnProcess;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn: SpawnProcess = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter() as ChildProcess;
    process.nextTick(() => child.emit("exit", exitCode, null));
    return child;
  };
  return { spawn, calls };
}

function io(spawn: SpawnProcess, stdout = new PassThrough(), stderr = new PassThrough()) {
  return {
    stdin: new PassThrough(),
    stdout,
    stderr,
    homeDir: "/tmp/zro-install-test",
    cwd: "/tmp/zro-install-test",
    env: {},
    spawn,
  };
}

describe("zro install", () => {
  it("installs an agent's catalog package", async () => {
    const { spawn, calls } = recorder();
    const code = await run(["install", "claude"], io(spawn));

    expect(code).toBe(0);
    expect(calls).toEqual([{
      command: "npm",
      args: ["install", "--global", "@anthropic-ai/claude-code@latest"],
    }]);
  });

  it("accepts aliases and passes pinned versions directly to npm", async () => {
    const { spawn, calls } = recorder();
    const code = await run(["install", "cc@beta"], io(spawn));

    expect(code).toBe(0);
    expect(calls[0].args).toEqual([
      "install",
      "--global",
      "@anthropic-ai/claude-code@beta",
    ]);
  });

  it("installs Kilo Code from its official package by ID or alias", async () => {
    const latest = recorder();
    const pinned = recorder();
    const upgraded = recorder();

    expect(await run(["install", "kc"], io(latest.spawn))).toBe(0);
    expect(latest.calls[0]).toEqual({
      command: "npm",
      args: ["install", "--global", "@kilocode/cli@latest"],
    });

    expect(await run(["install", "kilocode@7.4.16"], io(pinned.spawn))).toBe(0);
    expect(pinned.calls[0].args).toEqual([
      "install",
      "--global",
      "@kilocode/cli@7.4.16",
    ]);

    expect(await run(["install", "kilo", "--upgrade"], io(upgraded.spawn))).toBe(0);
    expect(upgraded.calls[0].args.at(-1)).toBe("@kilocode/cli@latest");
  });

  it("upgrades agents and Zro by reinstalling latest", async () => {
    const agent = recorder();
    const self = recorder();

    expect(await run(["install", "codex", "--upgrade"], io(agent.spawn))).toBe(0);
    expect(agent.calls[0].args.at(-1)).toBe("@openai/codex@latest");

    expect(await run(["install", "--upgrade"], io(self.spawn))).toBe(0);
    expect(self.calls[0].args.at(-1)).toBe("@moonmath-ai/zro@latest");
  });

  it.each([
    ["hermes", "hermes-agent.nousresearch.com/install.sh", "--skip-setup"],
    ["grok", "x.ai/cli/install.sh", undefined],
    ["omp", "omp.sh/install", "--binary"],
  ])("uses the official installer for %s", async (tool, url, expectedArg) => {
    const { spawn, calls } = recorder();
    const code = await run(["install", tool], io(spawn));

    expect(code).toBe(0);
    expect(calls[0].command).toBe("bash");
    expect(calls[0].args.join(" ")).toContain(url);
    if (expectedArg) expect(calls[0].args.join(" ")).toContain(expectedArg);
  });

  it("accepts Oh My Pi's aliases for install and rejects pinned binary versions", async () => {
    const { spawn, calls } = recorder();
    const stderr = new PassThrough();

    expect(await run(["install", "oh-my-pi"], io(spawn))).toBe(0);
    expect(calls[0].args.join(" ")).toContain("https://omp.sh/install");
    expect(await run(["install", "ohmypi@17.1.7"], io(spawn, new PassThrough(), stderr))).toBe(1);
    expect(await text(stderr)).toContain("does not support pinned versions");
  });

  it("installs the shared Codex package for Codex App", async () => {
    const { spawn, calls } = recorder();

    expect(await run(["install", "codex-app"], io(spawn))).toBe(0);
    expect(calls[0].args).toEqual([
      "install",
      "--global",
      "@openai/codex@latest",
    ]);
  });

  it("returns a concise installer failure", async () => {
    const { spawn } = recorder(7);
    const stderr = new PassThrough();

    expect(await run(["install", "claude"], io(spawn, new PassThrough(), stderr))).toBe(1);
    expect(await text(stderr)).toContain("Install failed (npm exited with code 7)");
  });

  it("handles a missing package manager without a stack trace", async () => {
    const spawn: SpawnProcess = () => {
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("error", new Error("npm not found")));
      return child;
    };
    const stderr = new PassThrough();

    expect(await run(["install", "claude"], io(spawn, new PassThrough(), stderr))).toBe(1);
    expect(await text(stderr)).toContain("Could not start npm: npm not found");
  });
});

async function text(stream: PassThrough): Promise<string> {
  stream.end();
  let result = "";
  for await (const chunk of stream) result += chunk.toString();
  return result;
}
