import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { commandExists } from "../src/install.js";
import { run } from "../src/run.js";
import type { SpawnProcess } from "../src/types.js";

const sha256Hex = (contents: string): string => createHash("sha256").update(contents).digest("hex");

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

  it("updates zro itself through the update alias", async () => {
    const self = recorder();

    expect(await run(["update"], io(self.spawn))).toBe(0);
    expect(self.calls[0].args.at(-1)).toBe("@moonmath-ai/zro@latest");
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

  it("updates itself from the release manifest in single-executable builds", async () => {
    const { spawn, calls } = recorder();
    const stdout = new PassThrough();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zro-selfupdate-"));
    const execPath = path.join(directory, "zro");
    await fs.writeFile(execPath, "old-binary");
    const globals = globalThis as { __ZRO_VERSION__?: string; __ZRO_PLATFORM__?: string };
    globals.__ZRO_VERSION__ = "0.4.2";
    globals.__ZRO_PLATFORM__ = "linux-x64";
    try {
      const code = await run(["install", "--upgrade"], {
        ...io(spawn, stdout),
        execPath,
        fetch: async (input: string | URL | Request): Promise<Response> => {
          const url = String(input);
          if (url.endsWith("/manifest.json")) {
            return Response.json({
              version: "0.5.0",
              platforms: { "linux-x64": { checksum: sha256Hex("new-binary"), size: 10 } },
            });
          }
          return new Response("new-binary");
        },
      });
      expect(code).toBe(0);
    } finally {
      delete globals.__ZRO_VERSION__;
      delete globals.__ZRO_PLATFORM__;
    }
    expect(calls).toEqual([]);
    expect(await fs.readFile(execPath, "utf8")).toBe("new-binary");
    expect(await text(stdout)).toContain("Updated zro from 0.4.2 to 0.5.0.");
  });

  it("refuses a pinned self-version in single-executable builds", async () => {
    const { spawn, calls } = recorder();
    const stderr = new PassThrough();
    const globals = globalThis as { __ZRO_VERSION__?: string };
    globals.__ZRO_VERSION__ = "0.4.2";
    try {
      const code = await run(["install", "--upgrade", "--version", "0.3.0"], {
        ...io(spawn, new PassThrough(), stderr),
        fetch: async () => {
          throw new Error("unexpected fetch");
        },
      });
      expect(code).toBe(1);
    } finally {
      delete globals.__ZRO_VERSION__;
    }
    expect(calls).toEqual([]);
    const message = await text(stderr);
    expect(message).toContain("Release binaries cannot install a specific version");
    expect(message).toContain("bash -s -- 0.3.0");
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
