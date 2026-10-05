import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SpawnOptions } from "../src/engine/types.js";
import { escapeShimArgument, resolveWindowsCommand, spawnCommand } from "../src/process.js";

const windowsEnv = {
  ComSpec: "C:\\Windows\\system32\\cmd.exe",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  PATH: "",
} as NodeJS.ProcessEnv;

function record(platform: NodeJS.Platform, command: string, args: string[], env = windowsEnv) {
  const calls: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
  spawnCommand(
    ((c: string, a: string[], options: SpawnOptions) => {
      calls.push({ command: c, args: a, options });
      return undefined as never;
    }),
    platform,
    command,
    args,
    { cwd: "/tmp", env, stdio: "inherit" },
  );
  return calls[0];
}

describe("spawnCommand", () => {
  it("leaves commands untouched off Windows", () => {
    const call = record("linux", "claude", ["-p", "a&b"]);
    expect(call.command).toBe("claude");
    expect(call.args).toEqual(["-p", "a&b"]);
  });

  it("routes .cmd shims through cmd.exe with escaped, verbatim arguments", () => {
    const call = record("win32", "claude.cmd", ["--settings", '{"a":"b & c"}']);
    expect(call.command).toBe(windowsEnv.ComSpec);
    expect(call.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(call.options.windowsVerbatimArguments).toBe(true);
    expect(call.args[3]).not.toMatch(/(^|[^^])&/);
  });

  it("does not wrap real executables", () => {
    const call = record("win32", "C:\\tools\\claude.exe", ["-p", "a&b"]);
    expect(call.command).toBe("C:\\tools\\claude.exe");
    expect(call.args).toEqual(["-p", "a&b"]);
  });

  it("keeps the original command when nothing on PATH matches", () => {
    const env = { ...windowsEnv, PATH: path.join(os.tmpdir(), "zro-definitely-missing") };
    expect(resolveWindowsCommand("claude", env)).toBe("claude");
  });

  it("never resolves a command from the working directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-cwd-"));
    await fs.writeFile(path.join(dir, "claude.cmd"), "@echo off\r\n");
    const previous = process.cwd();
    process.chdir(dir);
    try {
      expect(resolveWindowsCommand("claude", { ...windowsEnv, PATH: "" })).toBe("claude");
    } finally {
      process.chdir(previous);
    }
  });
});

describe("escapeShimArgument", () => {
  it("escapes cmd metacharacters twice and quotes the argument", () => {
    expect(escapeShimArgument("a&b")).toBe("^^^\"a^^^&b^^^\"");
  });

  it("doubles a backslash that precedes a quote", () => {
    expect(escapeShimArgument('a\\"b')).toBe('^^^"a\\\\\\^^^"b^^^"');
  });
});

describe("real cmd.exe", () => {
  it.runIf(process.platform === "win32")("passes metacharacters to a shim as plain text", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-shim-"));
    const marker = path.join(dir, "pwned.txt");
    await fs.writeFile(path.join(dir, "echo.cmd"), "@echo off\r\necho %~1\r\n");

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawnCommand(
        nodeSpawn as never,
        "win32",
        path.join(dir, "echo.cmd"),
        [`x" & echo hacked > "${marker}" & "`],
        { cwd: dir, env: process.env, stdio: "pipe" as never },
      );
      let stdout = "";
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.once("error", reject);
      child.once("exit", () => resolve(stdout));
    });

    await expect(fs.access(marker)).rejects.toBeTruthy();
    expect(output).toContain("hacked");
  });
});
