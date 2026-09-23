import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SpawnOptions, SpawnProcess } from "./engine/types.js";

export const WINDOWS_LAUNCHER_ENV = "ZRO_WINDOWS_LAUNCHER";

export function spawnCommand(
  spawn: SpawnProcess,
  platform: NodeJS.Platform,
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  const env = options.env ?? process.env;
  const resolved = resolveWindowsCommand(command, platform, env);
  return spawn(resolveCommand(resolved, platform, env), resolveArgs(resolved, args, platform, env), options);
}

export function resolveCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== "win32") return command;

  if (isCommandShim(command)) return env.ComSpec || env.COMSPEC || "cmd.exe";

  const quoted = /^"(.*)"$/.exec(command);
  if (quoted) return command;

  const extensions = windowsExecutableExtensions(env.PATHEXT);
  if (extensions.some((extension) => command.toLowerCase().endsWith(extension))) return command;

  return findOnPath(command, extensions, env) ?? command;
}

// Node's bare spawn does not apply PATHEXT, so `claude` never finds `claude.cmd` even when the
// npm global bin directory is on PATH. Resolve it ourselves.
export function findOnPath(
  command: string,
  extensions: string[],
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd(),
): string | undefined {
  const entries = (env.PATH || env.Path || "").split(path.win32.delimiter).filter(Boolean);
  const directories = [cwd, ...entries];
  const candidates = extensions.length ? extensions.map((extension) => `${command}${extension}`) : [command];

  for (const directory of directories) {
    for (const candidate of candidates) {
      const full = path.win32.resolve(directory, candidate);
      if (fs.existsSync(full)) return full;
    }
  }

  return undefined;
}

export function windowsExecutableExtensions(pathExt: string | undefined): string[] {
  const raw = pathExt || ".COM;.EXE;.BAT;.CMD";
  return raw
    .split(path.win32.delimiter)
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveArgs(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform !== "win32") return args;

  if (isCommandShim(command)) {
    return ["/d", "/s", "/c", command, ...args];
  }

  // Windows PowerShell 5.1 stops parsing native parameters at `--`, which silently drops the
  // arguments agents receive after it. Delegate to a generated script so the argv is splatted
  // unchanged and `--` only terminates PowerShell's own parameter binding.
  if (command === "powershell.exe") {
    const shell = env.SystemRoot || env.SYSTEMROOT;
    const resolved = shell
      ? path.win32.join(shell, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : command;
    return ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", launcherPath(), resolved];
  }

  return args;
}

export function isCommandShim(command: string): boolean {
  return /\.(?:cmd|bat)$/i.test(command);
}

export function launcherPath(): string {
  const file = path.join(os.tmpdir(), "zro", "windows-launcher.ps1");
  const contents = launcherScript();
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, { encoding: "utf8" });
  }
  return file;
}

export function launcherScript(): string {
  const lines = [
    // No param() block: everything after the script path lands in $args verbatim, so agent flags
    // like `--help`, `-p`, and `--` are never mistaken for PowerShell parameters.
    "$ErrorActionPreference = 'Stop'",
    "",
    "# Console.OutputEncoding throws when the process has no attached console.",
    "$OutputEncoding = try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch { $OutputEncoding }",
    "",
    "$target = $args[0]",
    "$forward = @($args[1..($args.Count - 1)])",
    "& $target @forward",
    "if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }",
  ];
  return lines.join("\r\n") + "\r\n";
}

export function resolveWindowsCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== "win32") return command;
  if (isCommandShim(command) || /^"/.test(command)) return command;

  const extensions = windowsExecutableExtensions(env.PATHEXT);
  if (extensions.some((extension) => command.toLowerCase().endsWith(extension))) return command;

  return findOnPath(command, extensions, env) ?? command;
}
