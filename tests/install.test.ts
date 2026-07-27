import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import type { SpawnOptions, SpawnProcess } from "../src/types.js";
import type { VersionCheck } from "../src/upgrade.js";

describe("zro install", () => {
  it("installs the right npm spec for a harness and prints a launch hint", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-claude-"));
    const spawnCalls: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
    const fakeSpawn: SpawnProcess = (command, args, options) => {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    const stdout = new PassThrough();
    const code = await run(["install", "claude"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn
    });

    expect(code).toBe(0);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("npm");
    expect(spawnCalls[0].args).toEqual(["install", "-g", "@anthropic-ai/claude-code@latest"]);
    expect(spawnCalls[0].options).toMatchObject({ cwd: home, stdio: "inherit" });

    const output = await streamText(stdout);
    expect(output).toContain("Installing Claude Code (@anthropic-ai/claude-code@latest)");
    expect(output).toContain("Installed Claude Code. Run: zro launch claude");
  });

  it("installs each npm harness by id with the right spec", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-ids-"));
    const specs: Record<string, string> = {
      codex: "@openai/codex@latest",
      opencode: "opencode-ai@latest",
      pi: "@earendil-works/pi-coding-agent@latest",
      openclaw: "openclaw@latest"
    };

    for (const [id, pkg] of Object.entries(specs)) {
      let installedSpec: string | null = null;
      const fakeSpawn: SpawnProcess = (_command, args) => {
        installedSpec = args[2] ?? null;
        const child = new EventEmitter() as ChildProcess;
        process.nextTick(() => child.emit("exit", 0, null));
        return child;
      };

      const code = await run(["install", id], {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        homeDir: home,
        cwd: home,
        env: {},
        spawn: fakeSpawn
      });

      expect(code).toBe(0);
      expect(installedSpec).toBe(pkg);
    }
  });

  it("installs hermes via its curl installer rather than npm", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-hermes-"));
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      // `command -v hermes` PATH lookup reports not found; the installer runs
      // and links the binary into ~/.local/bin, so zro checks that dir on disk.
      if (command === "command" && args[0] === "-v") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        process.nextTick(() => {
          out.end("");
          child.emit("exit", 1, null);
        });
        return child;
      }
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    const stdout = new PassThrough();
    const code = await run(["install", "hermes"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn
    });

    expect(code).toBe(0);
    // The install runs `bash -c 'curl -fsSL <url> | bash -s -- --skip-setup'`,
    // never `npm install`.
    const bashCall = spawnCalls.find((call) => call.command === "bash");
    expect(bashCall).toBeDefined();
    expect(bashCall!.args[1]).toMatch(/curl -fsSL https:\/\/hermes-agent\.nousresearch\.com\/install\.sh \| bash -s -- --skip-setup/);
    expect(spawnCalls.some((call) => call.command === "npm" && call.args[0] === "install")).toBe(false);
    const output = await streamText(stdout);
    expect(output).toContain("Installing Hermes");
    expect(output).toContain("Hermes installed");
  });

  it("rejects --version for a curl-installer harness", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-hermes-ver-"));
    let spawnCalled = false;
    const fakeSpawn: SpawnProcess = () => {
      spawnCalled = true;
      return new EventEmitter() as ChildProcess;
    };
    const stderr = new PassThrough();

    const code = await run(["install", "hermes", "--version", "1.2.3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn
    });

    expect(code).toBe(1);
    expect(spawnCalled).toBe(false);
    expect(await streamText(stderr)).toContain("does not support --version");
  });

  it("returns npm's non-zero exit code as 1 with a failure message", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-fail-"));
    const fakeSpawn: SpawnProcess = (_command, _args, _options) => {
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 7, null));
      return child;
    };
    const stderr = new PassThrough();

    const code = await run(["install", "codex"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn
    });

    expect(code).toBe(1);
    expect(await streamText(stderr)).toContain("Failed to install Codex CLI (npm exited with code 7)");
  });

  it("rejects codex-app with a hint to install codex", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-codexapp-"));
    let spawnCalled = false;
    const fakeSpawn: SpawnProcess = () => {
      spawnCalled = true;
      return new EventEmitter() as ChildProcess;
    };
    const stderr = new PassThrough();

    const code = await run(["install", "codex-app"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn
    });

    expect(code).toBe(1);
    expect(spawnCalled).toBe(false);
    const text = await streamText(stderr);
    expect(text).toContain("codex-app uses the same package as codex");
    expect(text).toContain("zro install codex");
  });

  it("rejects an unknown tool and lists installable ids", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-unknown-"));
    const stderr = new PassThrough();

    const code = await run(["install", "bogus"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {}
    });

    expect(code).toBe(1);
    const text = await streamText(stderr);
    expect(text).toContain("Unsupported tool: bogus");
    expect(text).toContain("claude");
    expect(text).toContain("codex");
    expect(text).toContain("openclaw");
  });

  it("does not run the upgrade check or require an API key", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-standalone-"));
    let fetchCalled = false;
    const fakeSpawn: SpawnProcess = () => {
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };
    const stderr = new PassThrough();

    const code = await run(["install", "claude"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => {
        fetchCalled = true;
        return "0.2.0";
      }
    });

    expect(code).toBe(0);
    expect(fetchCalled).toBe(false);
    expect(await streamText(stderr)).toBe("");
  });
});

describe("zro install --version", () => {
  it("installs a pinned version after resolving it against the registry", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-version-"));
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };
    const resolvePackageVersion = async (_pkg: string, version: string): Promise<VersionCheck> => {
      expect(version).toBe("1.2.3");
      return { found: true, version: "1.2.3" };
    };

    const code = await run(["install", "claude", "--version", "1.2.3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      resolvePackageVersion
    });

    expect(code).toBe(0);
    expect(spawnCalls[0].args).toEqual(["install", "-g", "@anthropic-ai/claude-code@1.2.3"]);
  });

  it("accepts tool@tag as equivalent to --version <tag>", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-atag-"));
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    const code = await run(["install", "claude@1.4.0"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      resolvePackageVersion: async () => ({ found: true, version: "1.4.0" })
    });

    expect(code).toBe(0);
    expect(spawnCalls[0].args).toEqual(["install", "-g", "@anthropic-ai/claude-code@1.4.0"]);
  });

  it("resolves a dist-tag to its concrete version", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-disttag-"));
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    const code = await run(["install", "codex", "--version", "beta"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      resolvePackageVersion: async (_pkg, version) =>
        version === "beta" ? { found: true, version: "0.9.0-beta.1" } : { found: false }
    });

    expect(code).toBe(0);
    expect(spawnCalls[0].args).toEqual(["install", "-g", "@openai/codex@0.9.0-beta.1"]);
  });

  it("prints 'version not found' and does not run npm when the version is missing", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-missing-"));
    let spawnCalled = false;
    const fakeSpawn: SpawnProcess = () => {
      spawnCalled = true;
      return new EventEmitter() as ChildProcess;
    };
    const stderr = new PassThrough();

    const code = await run(["install", "claude", "--version", "9.9.9"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      resolvePackageVersion: async () => ({ found: false })
    });

    expect(code).toBe(1);
    expect(spawnCalled).toBe(false);
    const text = await streamText(stderr);
    expect(text).toContain("version not found: 9.9.9");
    expect(text).toContain("@anthropic-ai/claude-code");
  });

  it("rejects conflicting --version and tool@tag", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-conflict-"));
    const stderr = new PassThrough();

    const code = await run(["install", "claude@1.0.0", "--version", "2.0.0"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {}
    });

    expect(code).toBe(1);
    expect(await streamText(stderr)).toContain("Conflicting versions");
  });
});

describe("zro install --upgrade", () => {
  it("upgrades a harness when an installed version is older than latest", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-upgrade-"));
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      // npm root -g
      if (args[0] === "root") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        process.nextTick(() => {
          out.end(path.join(home, "node_modules"));
        });
        return child;
      }
      // npm ls -g <pkg> --json
      if (args[0] === "ls") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        process.nextTick(() =>
          out.end(JSON.stringify({ dependencies: { "@anthropic-ai/claude-code": { version: "1.0.0" } } }))
        );
        process.nextTick(() => child.emit("exit", 0, null));
        return child;
      }
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    await fs.mkdir(path.join(home, "node_modules", "@anthropic-ai", "claude-code"), { recursive: true });
    await fs.writeFile(
      path.join(home, "node_modules", "@anthropic-ai", "claude-code", "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-code", version: "1.0.0", bin: { claude: "cli.js" } })
    );

    const stdout = new PassThrough();
    const code = await run(["install", "claude", "--upgrade"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      resolvePackageVersion: async () => ({ found: true, version: "1.2.0" })
    });

    expect(code).toBe(0);
    const installCall = spawnCalls.find((call) => call.args[0] === "install");
    expect(installCall?.args).toEqual(["install", "-g", "@anthropic-ai/claude-code@1.2.0"]);
    const output = await streamText(stdout);
    expect(output).toContain("Updating Claude Code 1.0.0 → 1.2.0");
  });

  it("reports up to date when the installed version matches latest", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-uptodate-"));
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      if (args[0] === "root") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        process.nextTick(() => out.end(path.join(home, "node_modules")));
        return child;
      }
      if (args[0] === "ls") {
        const out = new PassThrough();
        Object.assign(child, { stdout: out as unknown as NodeJS.ReadableStream });
        process.nextTick(() =>
          out.end(JSON.stringify({ dependencies: { "@anthropic-ai/claude-code": { version: "1.2.0" } } }))
        );
        process.nextTick(() => child.emit("exit", 0, null));
        return child;
      }
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    await fs.mkdir(path.join(home, "node_modules", "@anthropic-ai", "claude-code"), { recursive: true });
    await fs.writeFile(
      path.join(home, "node_modules", "@anthropic-ai", "claude-code", "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-code", version: "1.2.0", bin: { claude: "cli.js" } })
    );

    const stdout = new PassThrough();
    const code = await run(["install", "claude", "--upgrade"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      resolvePackageVersion: async () => ({ found: true, version: "1.2.0" })
    });

    expect(code).toBe(0);
    expect(spawnCalls.some((call) => call.args[0] === "install")).toBe(false);
    expect(await streamText(stdout)).toContain("up to date");
  });

  it("upgrades zro itself when no tool is given", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-self-"));
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    const stdout = new PassThrough();
    const code = await run(["install", "--upgrade"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      currentVersion: "0.1.5",
      execPath: "/usr/bin/node",
      scriptPath: "/usr/lib/node_modules/@moonmath-ai/zro/dist/cli.js",
      resolvePackageVersion: async () => ({ found: true, version: "0.2.0" })
    });

    expect(code).toBe(0);
    expect(spawnCalls[0].args).toEqual(["install", "-g", "@moonmath-ai/zro@0.2.0"]);
    expect(spawnCalls[1].args).toEqual([
      "/usr/lib/node_modules/@moonmath-ai/zro/dist/cli.js",
      "--version"
    ]);
    const output = await streamText(stdout);
    expect(output).toContain("Upgrading @moonmath-ai/zro to 0.2.0");
    expect(output).toContain("Upgrade complete");
  });

  it("prints 'version not found' when a pinned self-upgrade version is missing", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-self-missing-"));
    let spawnCalled = false;
    const fakeSpawn: SpawnProcess = () => {
      spawnCalled = true;
      return new EventEmitter() as ChildProcess;
    };
    const stderr = new PassThrough();

    const code = await run(["install", "--upgrade", "--version", "9.9.9"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      spawn: fakeSpawn,
      resolvePackageVersion: async () => ({ found: false })
    });

    expect(code).toBe(1);
    expect(spawnCalled).toBe(false);
    const text = await streamText(stderr);
    expect(text).toContain("version not found: 9.9.9");
    expect(text).toContain("@moonmath-ai/zro");
  });

  it("requires a tool or --upgrade", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-install-reqtool-"));
    const stderr = new PassThrough();

    const code = await run(["install"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {}
    });

    expect(code).toBe(1);
    const text = await streamText(stderr);
    expect(text).toContain("Missing <tool>");
    expect(text).toContain("--upgrade");
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
