import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SpawnOptions, SpawnProcess } from "./engine/types.js";

const META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

export function spawnCommand(
  spawn: SpawnProcess,
  platform: NodeJS.Platform,
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  if (platform !== "win32") return spawn(command, args, options);

  const resolved = resolveWindowsCommand(command, options.env);
  if (!isCommandShim(resolved)) return spawn(resolved, args, options);

  // Spawning cmd.exe ourselves skips Node's refusal to run .cmd/.bat with arguments, so every
  // token is escaped for cmd.exe's own parser. Otherwise `&` or `"` in an argument runs commands.
  const line = [escapeCommand(resolved), ...args.map(escapeShimArgument)].join(" ");
  return spawn(
    options.env.ComSpec || options.env.COMSPEC || "cmd.exe",
    ["/d", "/s", "/c", `"${line}"`],
    { ...options, windowsVerbatimArguments: true },
  );
}

export function isCommandShim(command: string): boolean {
  return /\.(?:cmd|bat)$/i.test(command);
}

export function windowsExecutableExtensions(pathExt: string | undefined): string[] {
  return (pathExt || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
}

// Node's bare spawn does not apply PATHEXT, so `claude` never finds `claude.cmd`. PATH only: the
// current directory is deliberately not searched, so a repository cannot plant a binary.
export function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv): string {
  const extensions = windowsExecutableExtensions(env.PATHEXT);
  if (extensions.some((extension) => command.toLowerCase().endsWith(extension))) return command;

  const directories = (env.PATH || env.Path || "").split(path.win32.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.win32.resolve(directory, `${command}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return command;
}

// Quoting rules from https://qntm.org/cmd, applied twice because a .cmd shim re-parses its
// arguments (the same approach as cross-spawn).
export function escapeShimArgument(argument: string): string {
  const quoted = `"${argument
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(META_CHARS, "^$1").replace(META_CHARS, "^$1");
}

export function escapeCommand(command: string): string {
  return command.replace(META_CHARS, "^$1");
}
