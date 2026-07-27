import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { run as runCli } from "../src/run.js";
import type { RunIo, SpawnOptions, SpawnProcess } from "../src/types.js";

function run(argv: string[], io: RunIo): Promise<number> {
  return runCli(argv, {
    fetch: async () => new Response(null, { status: 200 }),
    ...io,
  });
}

/**
 * A spawn fake that records every call and lets each subcommand be answered
 * independently. `npm root -g` and `npm ls -g <pkg> --json` are answered to
 * reflect whether a package is globally installed; `npm install -g <spec>`
 * exits with the given code; and the launched harness binary exits 0.
 */
function makeSpawn(options: {
  installedPackage?: { name: string; version: string; bin: string };
  globalRootContents?: string;
  installExitCode?: number;
  harnessCommand?: string;
  onLaunch?: (command: string, args: string[], opts: SpawnOptions) => void;
  pathLookup?: string | null;
}): { spawn: SpawnProcess; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn: SpawnProcess = (command, args, opts) => {
    calls.push({ command, args });

    const child = new EventEmitter() as ChildProcess;

    // `npm root -g` — return the global node_modules root we simulate.
    if (command === "npm" && args[0] === "root") {
      const out = new PassThrough();
      Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
      process.nextTick(() => out.end(options.globalRootContents ?? ""));
      return child;
    }

    // `npm ls -g <pkg> --json` — report the installed version, or empty.
    if (command === "npm" && args[0] === "ls") {
      const out = new PassThrough();
      Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
      const pkg = options.installedPackage;
      const data = pkg
        ? { dependencies: { [pkg.name]: { version: pkg.version } } }
        : {};
      process.nextTick(() => {
        out.end(JSON.stringify(data));
        child.emit("exit", 0, null);
      });
      return child;
    }

    // `npm install -g <spec>`
    if (command === "npm" && args[0] === "install") {
      process.nextTick(() => child.emit("exit", options.installExitCode ?? 0, null));
      return child;
    }

    // `command -v <binary>` PATH lookup.
    if (command === "command" && args[0] === "-v") {
      const out = new PassThrough();
      Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
      process.nextTick(() => {
        out.end(options.pathLookup ?? "");
        child.emit("exit", options.pathLookup ? 0 : 1, null);
      });
      return child;
    }

    // The launched harness binary.
    if (options.onLaunch) options.onLaunch(command, args, opts);
    process.nextTick(() => child.emit("exit", 0, null));
    return child;
  };

  return { spawn, calls };
}

describe("zro launch <tool> --install", () => {
  it("installs the latest harness when it is not installed, then launches", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-install-missing-"));
    // Simulate a global node_modules root with no claude package.
    const globalRoot = path.join(home, "node_modules");

    let launched = false;
    const { spawn, calls } = makeSpawn({
      globalRootContents: globalRoot,
      onLaunch: (command) => {
        expect(command).toBe("claude");
        launched = true;
      }
    });

    const stdout = new PassThrough();
    const code = await run(["launch", "claude", "--install", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn
    });

    expect(code).toBe(0);
    expect(launched).toBe(true);
    const installCall = calls.find((call) => call.command === "npm" && call.args[0] === "install");
    expect(installCall?.args).toEqual(["install", "-g", "@anthropic-ai/claude-code@latest"]);
    const output = await streamText(stdout);
    expect(output).toContain("Installing Claude Code");
    expect(output).toContain("Installed Claude Code");
  });

  it("skips install and launches when the harness is already installed", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-install-present-"));
    const globalRoot = path.join(home, "node_modules");
    // Plant the package on disk so findGlobalPackageByBinary resolves it.
    await fs.mkdir(path.join(globalRoot, "@anthropic-ai", "claude-code"), { recursive: true });
    await fs.writeFile(
      path.join(globalRoot, "@anthropic-ai", "claude-code", "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-code", version: "1.5.0", bin: { claude: "cli.js" } })
    );

    let installRan = false;
    let launched = false;
    const { spawn, calls } = makeSpawn({
      globalRootContents: globalRoot,
      installedPackage: { name: "@anthropic-ai/claude-code", version: "1.5.0", bin: "claude" },
      onLaunch: (command) => {
        expect(command).toBe("claude");
        launched = true;
      }
    });
    // Track install via closure since makeSpawn doesn't expose it directly.
    void installRan;

    const code = await run(["launch", "claude", "--install", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn
    });

    expect(code).toBe(0);
    expect(launched).toBe(true);
    expect(calls.some((call) => call.command === "npm" && call.args[0] === "install")).toBe(false);
  });

  it("launches without install when the binary is on PATH but not in npm global", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-install-path-"));
    let launched = false;
    const { spawn, calls } = makeSpawn({
      globalRootContents: "",
      pathLookup: "/usr/local/bin/claude",
      onLaunch: (command) => {
        expect(command).toBe("claude");
        launched = true;
      }
    });

    const code = await run(["launch", "claude", "--install", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn
    });

    expect(code).toBe(0);
    expect(launched).toBe(true);
    expect(calls.some((call) => call.command === "npm" && call.args[0] === "install")).toBe(false);
  });

  it("fails with a hint when a non-npm harness is not installed", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-install-grok-"));
    const stderr = new PassThrough();
    let launched = false;
    const { spawn } = makeSpawn({
      globalRootContents: "",
      pathLookup: null,
      onLaunch: () => {
        launched = true;
      }
    });

    const code = await run(["launch", "grok", "--install", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn
    });

    expect(code).toBe(1);
    expect(launched).toBe(false);
    const text = await streamText(stderr);
    expect(text).toContain("Grok Build is not installed via npm");
    expect(text).toContain("install.sh");
  });

  it("installs a curl-installer harness and launches without a shell reload", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-install-hermes-"));
    const binDir = path.join(home, ".local", "bin");
    let launched = false;
    const calls: Array<{ command: string; args: string[] }> = [];

    const spawn: SpawnProcess = (command, args) => {
      calls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;

      // `npm root -g` / `npm ls -g` — no global npm install of hermes.
      if (command === "npm" && args[0] === "root") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        process.nextTick(() => out.end(""));
        return child;
      }
      if (command === "npm" && args[0] === "ls") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        process.nextTick(() => {
          out.end("{}");
          child.emit("exit", 0, null);
        });
        return child;
      }
      // `command -v hermes` — not on PATH before install, resolves after because
      // zro prepends the installer's bin dir to PATH for the launch.
      if (command === "command" && args[0] === "-v") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        const onPath = calls.some((c) => c.command === "bash") ? path.join(binDir, "hermes") : "";
        process.nextTick(() => {
          out.end(onPath);
          child.emit("exit", onPath ? 0 : 1, null);
        });
        return child;
      }
      // The curl installer (`bash -c 'curl ... | bash -s -- --skip-setup'`):
      // simulate linking the binary into ~/.local/bin on disk.
      if (command === "bash") {
        (async () => {
          await fs.mkdir(binDir, { recursive: true });
          await fs.writeFile(path.join(binDir, "hermes"), "#!/bin/sh\n");
        })();
        process.nextTick(() => child.emit("exit", 0, null));
        return child;
      }
      // The launched hermes binary.
      expect(command).toBe("hermes");
      launched = true;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    const code = await run(["launch", "hermes", "--install", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn
    });

    expect(code).toBe(0);
    expect(launched).toBe(true);
    expect(calls.some((c) => c.command === "bash")).toBe(true);
    expect(calls.some((c) => c.command === "npm" && c.args[0] === "install")).toBe(false);
  });

  it("does not run the install check under --dry-run", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-install-dry-run-"));
    const { spawn, calls } = makeSpawn({
      globalRootContents: "",
      pathLookup: null
    });

    const stdout = new PassThrough();
    const code = await run(["launch", "claude", "--install", "--api-key", "sk-test", "--model", "minimax-m3", "--dry-run"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn
    });

    expect(code).toBe(0);
    // No install, no PATH lookup, no launch — just the printed plan.
    expect(calls.some((call) => call.command === "npm")).toBe(false);
    expect(calls.some((call) => call.command === "command")).toBe(false);
    const output = await streamText(stdout);
    expect(output).toContain("Session preview");
    expect(output).toContain("Nothing was launched or written");
  });

  it("returns the install failure when npm exits non-zero", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-install-fail-"));
    let launched = false;
    const { spawn } = makeSpawn({
      globalRootContents: "",
      pathLookup: null,
      installExitCode: 7,
      onLaunch: () => {
        launched = true;
      }
    });
    const stderr = new PassThrough();

    const code = await run(["launch", "claude", "--install", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn
    });

    expect(code).toBe(1);
    expect(launched).toBe(false);
    const text = await streamText(stderr);
    expect(text).toContain("Failed to install Claude Code (npm exited with code 7)");
  });
});

async function streamText(stream: PassThrough): Promise<string> {
  stream.end();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
