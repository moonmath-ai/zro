import type { ChildProcess } from "node:child_process";
import type { SpawnOptions, SpawnProcess } from "./engine/types.js";

const WINDOWS_COMMAND_ENV = "ZRO_WINDOWS_COMMAND";
const WINDOWS_ARGUMENTS_ENV = "ZRO_WINDOWS_ARGUMENTS";
const WINDOWS_LAUNCH_SCRIPT = [
  `$command = $env:${WINDOWS_COMMAND_ENV}`,
  `$arguments = ConvertFrom-Json $env:${WINDOWS_ARGUMENTS_ENV}`,
  "& $command @arguments",
  "if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }",
].join("; ");

export function spawnCommand(
  spawn: SpawnProcess,
  platform: NodeJS.Platform,
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  if (platform !== "win32") return spawn(command, args, options);

  return spawn("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    WINDOWS_LAUNCH_SCRIPT,
  ], {
    ...options,
    env: {
      ...options.env,
      [WINDOWS_COMMAND_ENV]: command,
      [WINDOWS_ARGUMENTS_ENV]: JSON.stringify(args),
    },
  });
}
