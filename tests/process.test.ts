import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findOnPath,
  isCommandShim,
  launcherScript,
  resolveArgs,
  resolveCommand,
  resolveWindowsCommand,
  windowsExecutableExtensions,
} from "../src/process.js";

const windowsEnv = {
  SystemRoot: "C:\\Windows",
  ComSpec: "C:\\Windows\\system32\\cmd.exe",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  PATH: "",
} as NodeJS.ProcessEnv;

describe("windows executable extensions", () => {
  it("defaults to the standard PATHEXT list", () => {
    expect(windowsExecutableExtensions(undefined)).toEqual([".com", ".exe", ".bat", ".cmd"]);
  });

  it("normalises a custom PATHEXT list", () => {
    expect(windowsExecutableExtensions(" .EXE ; .CMD ")).toEqual([".exe", ".cmd"]);
  });
});

describe("command resolution on Windows", () => {
  it("leaves commands untouched on POSIX platforms", () => {
    expect(resolveCommand("claude", "linux", windowsEnv)).toBe("claude");
    expect(resolveWindowsCommand("claude", "linux", windowsEnv)).toBe("claude");
    expect(resolveArgs("claude", ["-p", "hi"], "linux")).toEqual(["-p", "hi"]);
  });

  it("routes .cmd and .bat shims through cmd.exe", () => {
    expect(isCommandShim("claude.cmd")).toBe(true);
    expect(isCommandShim("claude.bat")).toBe(true);
    expect(isCommandShim("claude.exe")).toBe(false);
    expect(resolveCommand("claude.cmd", "win32", windowsEnv)).toBe("C:\\Windows\\system32\\cmd.exe");
  });

  it("does not rewrite commands that already carry an executable extension", () => {
    expect(resolveCommand("C:\\tools\\claude.exe", "win32", windowsEnv))
      .toBe("C:\\tools\\claude.exe");
    expect(resolveCommand("C:\\tools\\claude.exe", "win32", { ...windowsEnv, PATH: "" }))
      .toBe("C:\\tools\\claude.exe");
  });

  it("finds an npm shim through PATHEXT instead of relying on bare spawn", async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "zro-path-"));
    await fs.writeFile(path.join(bin, "claude.cmd"), "@echo off\r\n");

    const env = { ...windowsEnv, PATH: bin };
    expect(findOnPath("claude", windowsExecutableExtensions(env.PATHEXT), env))
      .toBe(path.join(bin, "claude.cmd"));
    expect(resolveWindowsCommand("claude", "win32", env)).toBe(path.join(bin, "claude.cmd"));

    // The shim now routes through cmd.exe rather than being spawned directly.
    expect(resolveCommand(resolveWindowsCommand("claude", "win32", env), "win32", env))
      .toBe(env.ComSpec);
  });

  it("prefers .exe over .cmd in PATHEXT order", async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "zro-path-"));
    await fs.writeFile(path.join(bin, "claude.cmd"), "@echo off\r\n");
    await fs.writeFile(path.join(bin, "claude.exe"), "");

    const env = { ...windowsEnv, PATH: bin };
    expect(resolveWindowsCommand("claude", "win32", env)).toBe(path.join(bin, "claude.exe"));
  });

  it("keeps the original command when nothing matches", () => {
    const env = { ...windowsEnv, PATH: path.join(os.tmpdir(), "zro-definitely-missing") };
    expect(resolveWindowsCommand("claude", "win32", env)).toBe("claude");
  });
});

describe("argument bridging on Windows", () => {
  it("passes shim arguments through cmd.exe without extra quoting", () => {
    const args = ["--managed-settings", '{"a":["b c"]}', "--", "-p", "hello world"];
    expect(resolveArgs("claude.cmd", args, "win32")).toEqual(["/d", "/s", "/c", "claude.cmd", ...args]);
  });

  it("launches PowerShell through a script so `--` reaches the agent untouched", () => {
    const built = resolveArgs("powershell.exe", ["-s", "--", "curl", "-fsSL"], "win32", windowsEnv);
    expect(built.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-File"]);
    expect(built[4]).toBe(path.join(os.tmpdir(), "zro", "windows-launcher.ps1"));
    expect(built[5]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it("leaves ordinary Windows commands alone", () => {
    expect(resolveArgs("npm", ["install", "--global", "pkg"], "win32", windowsEnv))
      .toEqual(["install", "--global", "pkg"]);
  });
});

describe("windows launcher script", () => {
  it("splats the forwarded argv without a param block", () => {
    const script = launcherScript();
    // A param() block would bind agent flags such as -p or --help as PowerShell parameters.
    expect(script).not.toMatch(/^\s*param\s*\(/m);
    expect(script).toContain("$target = $args[0]");
    expect(script).toContain("$forward = @($args[1..($args.Count - 1)])");
    expect(script).toContain("& $target @forward");
    expect(script).toContain("exit $LASTEXITCODE");
  });

  it("forces UTF-8 output and tolerates a missing console", () => {
    const script = launcherScript();
    expect(script).toContain("[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)");
    expect(script).toContain("catch { $OutputEncoding }");
  });
});