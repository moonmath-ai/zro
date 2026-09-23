import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import type { RunIo, SpawnProcess } from "../src/types.js";

function harness(options: {
  installExitCode?: number;
  onLaunch?: () => void;
} = {}): {
  spawn: SpawnProcess;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn: SpawnProcess = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter() as ChildProcess;
    if (command !== "npm") options.onLaunch?.();
    process.nextTick(() => {
      const code = command === "npm" ? options.installExitCode ?? 0 : 0;
      child.emit("exit", code, null);
    });
    return child;
  };
  return { spawn, calls };
}

function launchIo(home: string, spawn: SpawnProcess, env: NodeJS.ProcessEnv): RunIo {
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    homeDir: home,
    cwd: home,
    env,
    spawn,
    platform: "linux",
    fetch: async () => new Response(null, { status: 200 }),
  };
}

describe("zro <tool> --install", () => {
  it("installs a missing agent, then launches it", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-launch-"));
    let launched = false;
    const { spawn, calls } = harness({ onLaunch: () => { launched = true; } });

    const code = await run(
      ["claude", "--install", "--api-key", "sk-test"],
      launchIo(home, spawn, { PATH: "" }),
    );

    expect(code).toBe(0);
    expect(calls[0]).toEqual({
      command: "npm",
      args: ["install", "--global", "@anthropic-ai/claude-code@latest"],
    });
    expect(calls.at(-1)?.command).toBe("claude");
    expect(launched).toBe(true);
  });

  it("skips installation when the executable is already on PATH", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-existing-"));
    const bin = path.join(home, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, "claude"), "#!/bin/sh\n");
    await fs.chmod(path.join(bin, "claude"), 0o755);
    const { spawn, calls } = harness();

    const code = await run(
      ["claude", "--install", "--api-key", "sk-test"],
      launchIo(home, spawn, { PATH: bin }),
    );

    expect(code).toBe(0);
    expect(calls.some((call) => call.command === "npm")).toBe(false);
    expect(calls.at(-1)?.command).toBe("claude");
  });

  it("does nothing during a dry run", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-dry-run-"));
    const { spawn, calls } = harness();

    const code = await run(
      ["claude", "--install", "--api-key", "sk-test", "--dry-run"],
      launchIo(home, spawn, { PATH: "" }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("installs and launches Grok through its official installer", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-grok-"));
    const { spawn, calls } = harness();

    const code = await run(
      ["grok", "--install", "--api-key", "sk-test"],
      launchIo(home, spawn, { PATH: "" }),
    );

    expect(code).toBe(0);
    expect(calls[0].command).toBe("bash");
    expect(calls[0].args.join(" ")).toContain("https://x.ai/cli/install.sh");
    expect(calls.at(-1)?.command).toBe("grok");
  });

  it("installs and launches Kilo Code through its npm package", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-kilo-"));
    const { spawn, calls } = harness();

    const code = await run(
      ["kc", "--install", "--api-key", "sk-test"],
      launchIo(home, spawn, { PATH: "" }),
    );

    expect(code).toBe(0);
    expect(calls[0]).toEqual({
      command: "npm",
      args: ["install", "--global", "@kilocode/cli@latest"],
    });
    expect(calls.at(-1)?.command).toBe("kilo");
  });

  it("installs and launches Oh My Pi through its official binary installer", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-omp-"));
    const { spawn, calls } = harness();

    const code = await run(
      ["oh-my-pi", "--install", "--api-key", "sk-test"],
      launchIo(home, spawn, { PATH: "" }),
    );

    expect(code).toBe(0);
    expect(calls[0].command).toBe("bash");
    expect(calls[0].args.join(" ")).toContain("https://omp.sh/install");
    expect(calls[0].args.join(" ")).toContain("--binary");
    expect(calls.at(-1)?.command).toBe("omp");
  });

  it("stops when installation fails", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-failure-"));
    const { spawn, calls } = harness({ installExitCode: 9 });

    const code = await run(
      ["claude", "--install", "--api-key", "sk-test"],
      launchIo(home, spawn, { PATH: "" }),
    );

    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("npm");
  });
});
