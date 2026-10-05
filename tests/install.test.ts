import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { commandExists } from "../src/install.js";
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
    platform: "linux" as const,
  };
}

describe("zro install", () => {
  it("finds command shims using PATHEXT on Windows", async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "zro-win-bin-"));
    await fs.writeFile(path.join(bin, "codex.CMD"), "@echo off\r\n");

    await expect(commandExists("codex", { PATH: bin, PATHEXT: ".EXE;.CMD" }, "win32")).resolves.toBe(true);
  });

  it("targets the package manager regardless of platform", async () => {
    const { spawn, calls } = recorder();
    const code = await run(["install", "claude"], { ...io(spawn), platform: "win32" });

    expect(code).toBe(0);
    // Only the dispatched command is asserted here; platform bridging is covered in process.test.ts.
    expect(calls[0]).toEqual({
      command: "npm",
      args: ["install", "--global", "@anthropic-ai/claude-code@latest"],
    });
  });

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

  it("installs Kilo Code from its official package by alias", async () => {
    const { spawn, calls } = recorder();

    expect(await run(["install", "kc"], io(spawn))).toBe(0);
    expect(calls[0]).toEqual({
      command: "npm",
      args: ["install", "--global", "@kilocode/cli@latest"],
    });
  });

  it("upgrades agents and Zro by reinstalling latest", async () => {
    const agent = recorder();
    const self = recorder();

    expect(await run(["install", "codex", "--upgrade"], io(agent.spawn))).toBe(0);
    expect(agent.calls[0].args.at(-1)).toBe("@openai/codex@latest");

    const codexApp = recorder();
    expect(await run(["install", "codex-app"], io(codexApp.spawn))).toBe(0);
    expect(codexApp.calls[0].args.at(-1)).toBe("@openai/codex@latest");

    expect(await run(["install", "--upgrade"], io(self.spawn))).toBe(0);
    expect(self.calls[0].args.at(-1)).toBe("@moonmath-ai/zro@latest");
  });

  it.each([
    ["hermes", "hermes-agent.nousresearch.com/install.sh", "--skip-setup"],
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
