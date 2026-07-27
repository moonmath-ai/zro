import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { run as runCli } from "../src/run.js";
import { compareVersions } from "../src/upgrade.js";
import type { RunIo, SpawnOptions, SpawnProcess } from "../src/types.js";

const successfulSpawn: SpawnProcess = () => {
  const child = new EventEmitter() as ChildProcess;
  process.nextTick(() => child.emit("exit", 0, null));
  return child;
};

function run(argv: string[], io: RunIo): Promise<number> {
  return runCli(argv, {
    fetch: async () => new Response(null, { status: 200 }),
    spawn: successfulSpawn,
    ...io,
  });
}

describe("compareVersions", () => {
  it("ranks semver versions correctly", () => {
    expect(compareVersions("0.1.5", "0.1.5")).toBe(0);
    expect(compareVersions("0.1.4", "0.1.5")).toBe(-1);
    expect(compareVersions("0.1.5", "0.1.4")).toBe(1);
  });

  it("strips a leading v prefix and handles different segment counts", () => {
    expect(compareVersions("v0.1.5", "0.1.5")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0.1", "1.0.0")).toBe(1);
  });
});

describe("upgrade check", () => {
  it("keeps previews side-effect free by skipping the upgrade check", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-preview-"));
    let fetched = false;
    let spawned = false;

    const code = await runCli(
      ["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3", "--dry-run"],
      {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        homeDir: home,
        cwd: home,
        env: {},
        fetchLatestVersion: async () => {
          fetched = true;
          return "99.0.0";
        },
        spawn: () => {
          spawned = true;
          return new EventEmitter() as ChildProcess;
        },
      },
    );

    expect(code).toBe(0);
    expect(fetched).toBe(false);
    expect(spawned).toBe(false);
  });

  it("skips upgrade check when fetchLatestVersion is not provided", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-skip-"));
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    const code = await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout,
      stderr,
      homeDir: home,
      cwd: home,
      env: {}
    });

    expect(code).toBe(0);
    const errText = await streamText(stderr);
    expect(errText).not.toContain("out of date");
  });

  it("proceeds silently when current version is latest or newer", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-current-"));
    const stderr = new PassThrough();

    const code = await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.2.0",
      fetchLatestVersion: async () => "0.1.5"
    });

    expect(code).toBe(0);
    expect(await streamText(stderr)).not.toContain("out of date");
  });

  it("prints a non-blocking message in non-TTY when out of date", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-nontty-"));
    const stderr = new PassThrough();

    const code = await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => "0.2.0"
    });

    expect(code).toBe(0);
    expect(await streamText(stderr)).toContain("npm install -g @moonmath-ai/zro@latest");
  });

  it("shows blocking prompt in TTY when out of date and skips on Enter (default)", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-tty-skip-"));
    const stdin = makeTtyStdin();
    const stdout = makeTtyStdout();

    const codePromise = run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin,
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => "0.2.0",
      spawn: fakeExitSpawn(() => {})
    });
    stdin.end("\r");

    const code = await codePromise;
    expect(code).toBe(0);
    const output = await streamText(stdout);
    expect(output).toContain("🚀 Update available: 0.1.5 → 0.2.0");
    expect(output).toContain("Upgrade now (runs: npm install -g @moonmath-ai/zro@latest)");
    expect(output).toContain("Skip until next version");
  });

  it("skips until next version and caches the skipped version", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-skip-next-"));

    let fetchCount = 0;
    const fetchLatest = async (): Promise<string | null> => {
      fetchCount += 1;
      return "0.2.0";
    };

    const stdin1 = makeTtyStdin();
    const stdout1 = makeTtyStdout();
    const code1Promise = run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: stdin1,
      stdout: stdout1,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: fetchLatest,
      spawn: fakeExitSpawn(() => {})
    });
    stdin1.end("\u001b[B\u001b[B\r");
    await code1Promise;

    const cachePath = path.join(home, ".config", "zro", "upgrade-check.json");
    const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
    expect(cache.skippedVersion).toBe("0.2.0");

    const stdin2 = makeTtyStdin();
    const stdout2 = makeTtyStdout();
    const code2 = await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: stdin2,
      stdout: stdout2,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: fetchLatest,
      spawn: fakeExitSpawn(() => {})
    });

    expect(code2).toBe(0);
    expect(await streamText(stdout2)).not.toContain("🚀 Update available");
  });

  it("does not fetch from npm when cache is fresh within 24h", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-cache-"));
    const cacheDir = path.join(home, ".config", "zro");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, "upgrade-check.json"),
      JSON.stringify({
        lastCheckedAt: new Date().toISOString(),
        latestVersion: "0.2.0",
        skippedVersion: null
      })
    );

    let fetchCalled = false;
    const code = await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => {
        fetchCalled = true;
        return "0.3.0";
      }
    });

    expect(code).toBe(0);
    expect(fetchCalled).toBe(false);
  });

  it("fetches from npm when cache is older than 24h", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-stale-"));
    const cacheDir = path.join(home, ".config", "zro");
    await fs.mkdir(cacheDir, { recursive: true });
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      path.join(cacheDir, "upgrade-check.json"),
      JSON.stringify({
        lastCheckedAt: oldDate,
        latestVersion: "0.2.0",
        skippedVersion: null
      })
    );

    let fetchCalled = false;
    const code = await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => {
        fetchCalled = true;
        return "0.1.5";
      }
    });

    expect(code).toBe(0);
    expect(fetchCalled).toBe(true);
  });

  it("proceeds silently when fetch fails", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-fetch-fail-"));
    const stderr = new PassThrough();

    const code = await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => {
        throw new Error("Network error");
      }
    });

    expect(code).toBe(0);
    expect(await streamText(stderr)).not.toContain("out of date");
  });

  it("upgrade flow runs npm install and re-execs zro", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-flow-"));
    const stdin = makeTtyStdin();
    const stdout = makeTtyStdout();

    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn: SpawnProcess = (command, args, _options) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", 0, null));
      return child;
    };

    const codePromise = run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin,
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => "0.2.0",
      spawn: fakeSpawn,
      execPath: "/usr/bin/node",
      scriptPath: "/usr/lib/node_modules/@moonmath-ai/zro/dist/cli.js"
    });
    stdin.end("\r");

    const code = await codePromise;
    expect(code).toBe(0);

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0].args).toEqual(["install", "-g", "@moonmath-ai/zro@latest"]);
    expect(spawnCalls[1].args).toEqual([
      "/usr/lib/node_modules/@moonmath-ai/zro/dist/cli.js",
      "launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"
    ]);
  });

  it("upgrade failure falls through to launch with a warning", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-fail-"));
    const stdin = makeTtyStdin();
    const stdout = makeTtyStdout();
    const stderr = new PassThrough();

    let spawnCallCount = 0;
    const fakeSpawn: SpawnProcess = (_command, _args, _options) => {
      spawnCallCount += 1;
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => child.emit("exit", spawnCallCount === 1 ? 1 : 0, null));
      return child;
    };

    const codePromise = run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin,
      stdout,
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => "0.2.0",
      spawn: fakeSpawn,
      execPath: "/usr/bin/node",
      scriptPath: "/usr/lib/node_modules/@moonmath-ai/zro/dist/cli.js"
    });
    stdin.end("\r");

    const code = await codePromise;
    expect(code).toBe(0);
    expect(spawnCallCount).toBe(2);
    expect(await streamText(stderr)).toContain("Failed to upgrade");
  });

  it("Ctrl+C during prompt exits with code 1", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-interrupt-"));
    const stdin = makeTtyStdin();
    const stdout = makeTtyStdout();
    const stderr = new PassThrough();

    const codePromise = run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin,
      stdout,
      stderr,
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => "0.2.0"
    });
    stdin.end("\u0003");

    const code = await codePromise;
    expect(code).toBe(1);
  });

  it("does not run upgrade check for login/logout/auth-status", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-auth-"));
    let fetchCalled = false;

    const code = await run(["login", "--api-key", "sk-test"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => {
        fetchCalled = true;
        return "0.2.0";
      }
    });

    expect(code).toBe(0);
    expect(fetchCalled).toBe(false);
  });

  it("writes cache file with 0o600 permissions", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-upgrade-perms-"));

    await run(["launch", "claude", "--api-key", "sk-test", "--model", "minimax-m3"], {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {},
      currentVersion: "0.1.5",
      fetchLatestVersion: async () => "0.2.0"
    });

    const cachePath = path.join(home, ".config", "zro", "upgrade-check.json");
    const stat = await fs.stat(cachePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

function makeTtyStdin(): PassThrough & { isTTY: boolean; isRaw: boolean; setRawMode: (m: boolean) => void } {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (mode: boolean) => void;
  };
  stream.isTTY = true;
  stream.isRaw = false;
  stream.setRawMode = (mode: boolean) => {
    stream.isRaw = mode;
  };
  return stream;
}

function makeTtyStdout(): PassThrough & { isTTY: boolean } {
  const stream = new PassThrough() as PassThrough & { isTTY: boolean };
  stream.isTTY = true;
  return stream;
}

function fakeExitSpawn(assertion: (command: string, args: string[], options: SpawnOptions) => void): SpawnProcess {
  return (command, args, options) => {
    assertion(command, args, options);
    const child = new EventEmitter() as ChildProcess;
    process.nextTick(() => child.emit("exit", 0, null));
    return child;
  };
}

async function streamText(stream: PassThrough): Promise<string> {
  stream.end();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
