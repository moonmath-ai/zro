import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveTool, TOOLS, type ToolDescriptor } from "./catalog.js";
import type { SpawnProcess } from "./engine/types.js";
import type { RunIo } from "./types.js";

const ZRO_PACKAGE = "@moonmath-ai/zro";

export interface InstallArgs {
  tool?: string;
  upgrade?: boolean;
  version?: string;
}

export async function install(
  request: InstallArgs,
  io: RunIo,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  if (!request.tool) {
    return installNpm(
      `${ZRO_PACKAGE}@${request.version ?? "latest"}`,
      request.version ? `Installing Zro ${request.version}` : "Upgrading Zro",
      io,
      env,
    );
  }

  const tool = resolveInstallableTool(request.tool, io);
  if (!tool) return 1;
  return installTool(tool, request, io, env);
}

export async function ensureHarnessInstalled(
  toolId: string,
  io: RunIo,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const tool = TOOLS.find((candidate) => candidate.id === toolId);
  if (!tool) return false;
  if (await commandExists(tool.executable, env)) return true;
  if (!tool.package && !tool.installer) {
    io.stderr.write(`${tool.name} cannot be installed automatically.\n`);
    return false;
  }

  io.stdout.write(`${tool.name} is not installed; installing it now.\n`);
  return (await installTool(tool, {}, io, env)) === 0;
}

export async function commandExists(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    try {
      await fs.access(path.join(directory, command), fs.constants.X_OK);
      return true;
    } catch {
      // Keep searching.
    }
  }
  return false;
}

function resolveInstallableTool(value: string, io: RunIo): ToolDescriptor | undefined {
  const id = resolveTool(value);
  if (!id) {
    io.stderr.write(`Unknown tool "${value}". Choose: ${TOOLS.map((tool) => tool.id).join(", ")}.\n`);
    return undefined;
  }
  const tool = TOOLS.find((candidate) => candidate.id === id)!;
  if (!tool.package && !tool.installer) {
    io.stderr.write(`${tool.name} cannot be installed automatically.\n`);
    return undefined;
  }
  return tool;
}

async function installTool(
  tool: ToolDescriptor,
  request: Pick<InstallArgs, "upgrade" | "version">,
  io: RunIo,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  if (tool.installer) {
    if (request.version) {
      io.stderr.write(`${tool.name} does not support pinned versions.\n`);
      return 1;
    }
    return installWithScript(tool, io, env);
  }

  const packageName = stripVersion(tool.package!);
  const version = request.version ?? (request.upgrade ? "latest" : defaultVersion(tool.package!));
  const verb = request.upgrade ? "Upgrading" : "Installing";
  return installNpm(`${packageName}@${version}`, `${verb} ${tool.name}`, io, env);
}

async function installNpm(
  spec: string,
  message: string,
  io: RunIo,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  io.stdout.write(`${message}…\n`);
  let code: number;
  try {
    code = await runAndWait(io, "npm", ["install", "--global", spec], env);
  } catch (error) {
    io.stderr.write(`Could not start npm: ${messageOf(error)}.\n`);
    return 1;
  }
  if (code !== 0) {
    io.stderr.write(`Install failed (npm exited with code ${code}).\n`);
    return 1;
  }
  io.stdout.write("Done.\n");
  return 0;
}

async function installWithScript(
  tool: ToolDescriptor,
  io: RunIo,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const installer = tool.installer!;
  const args = installer.args ?? [];
  io.stdout.write(`Installing ${tool.name}…\n`);
  const command = `curl -fsSL ${shellQuote(installer.url)} | bash -s -- ${args.map(shellQuote).join(" ")}`;
  let code: number;
  try {
    code = await runAndWait(io, "bash", ["-c", command], env);
  } catch (error) {
    io.stderr.write(`Could not start the ${tool.name} installer: ${messageOf(error)}.\n`);
    return 1;
  }
  if (code !== 0) {
    io.stderr.write(`Install failed (installer exited with code ${code}).\n`);
    return 1;
  }

  const binDir = path.join(io.homeDir, installer.binDir);
  if (await commandExists(tool.executable, { ...env, PATH: binDir })) {
    env.PATH = env.PATH ? `${binDir}${path.delimiter}${env.PATH}` : binDir;
  }
  io.stdout.write("Done.\n");
  return 0;
}

function runAndWait(
  io: RunIo,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  const child = spawn(command, args, { cwd: io.cwd, env, stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(typeof code === "number" ? code : 1));
  });
}

function stripVersion(spec: string): string {
  const match = spec.match(/^(@[^/]+\/[^@]+|[^@]+)@.+$/);
  return match?.[1] ?? spec;
}

function defaultVersion(spec: string): string {
  const match = spec.match(/^(@[^/]+\/[^@]+|[^@]+)@(.+)$/);
  return match?.[2] ?? "latest";
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=%@,+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
