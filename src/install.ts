import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { TOOLS, type ToolDescriptor } from "./catalog.js";
import type { RunIo } from "./types.js";
import type { SpawnOptions, SpawnProcess } from "./engine/types.js";
import {
  compareVersions,
  getPackageVersion,
  resolvePackageVersion,
  type VersionCheck
} from "./upgrade.js";

type ToolInstaller = NonNullable<ToolDescriptor["installer"]>;

export interface InstallArgs {
  tool?: string;
  upgrade?: boolean;
  version?: string;
}

export async function install(args: InstallArgs, io: RunIo, env: NodeJS.ProcessEnv): Promise<number> {
  // `zro install --upgrade` with no tool upgrades zro itself.
  if (!args.tool) {
    return upgradeSelf(io, env, args.version);
  }

  const harness = resolveHarness(args.tool, io);
  if (!harness) return 1;

  return installHarness(harness, { version: args.version, upgrade: args.upgrade }, io, env);
}

/** Resolve a tool id to its harness descriptor, printing an error for unknown or non-installable tools. */
function resolveHarness(
  tool: string,
  io: RunIo
): ToolDescriptor | null {
  // `codex-app` launches the same `@openai/codex` package as `codex`; it has no
  // separate installable package, so point the user at `codex` instead.
  if (tool === "codex-app") {
    io.stderr.write(`codex-app uses the same package as codex. Run: zro install codex\n`);
    return null;
  }

  const harness = TOOLS.find((entry) => entry.id === tool);
  if (!harness) {
    const installable = TOOLS.map((entry) => entry.id).join(", ");
    io.stderr.write(`Unsupported tool: ${tool}\nInstallable tools: ${installable}\n`);
    return null;
  }

  // Grok Build is not distributed via npm and has no curl installer `zro` can
  // run itself; point the user at its own install instructions rather than
  // failing on an empty npm spec.
  if (!harness.package && !harness.installer) {
    io.stderr.write(
      `${harness.name} is not installed via npm. See its install instructions (e.g. for Grok Build: curl -fsSL https://x.ai/cli/install.sh | bash).\n`
    );
    return null;
  }

  return harness;
}

interface InstallHarnessOptions {
  version?: string;
  upgrade?: boolean;
}

/** Absolute path to a curl-installer's bin dir for the current user. */
function installerBinDir(installer: ToolInstaller, homeDir: string): string {
  return path.join(homeDir, installer.binDir);
}

/**
 * Run a curl-installer harness (e.g. Hermes). Pipes the fetched install script
 * to `bash`, then re-checks the binary so a fresh shell reload isn't required
 * for `zro launch` in the same process: if the binary still isn't on PATH but
 * the installer's bin dir now contains it, that dir is added to PATH via the
 * returned env so the immediate launch resolves it.
 */
async function runInstallerHarness(
  harness: ToolDescriptor,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<{ code: number; pathAddition?: string }> {
  const installer = harness.installer!;
  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  const args = installer.args ?? [];
  io.stdout.write(`Installing ${harness.name}...\n`);
  try {
    const code = await spawnAndWait(
      spawn,
      "bash",
      ["-c", `curl -fsSL ${shellQuote(installer.url)} | bash -s -- ${args.map(shellQuote).join(" ")}`],
      { cwd: io.cwd, env, stdio: "inherit" }
    );
    if (code !== 0) {
      io.stderr.write(`Failed to install ${harness.name} (installer exited with code ${code}).\n`);
      return { code: 1 };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`Failed to install ${harness.name} (${message}).\n`);
    return { code: 1 };
  }

  // The installer links the binary into a dir that may not yet be on this
  // process's PATH (it appends to ~/.bashrc for future shells). If the binary
  // isn't resolvable now, point the launch at the installer's bin dir so the
  // same `zro launch` call works without a manual shell reload.
  let pathAddition: string | undefined;
  if (!(await installedBinaryVersion(harness.executable, io, env)) && !(await findOnPath(harness.executable, io, env))) {
    const binDir = installerBinDir(installer, io.homeDir);
    if (await pathExists(path.join(binDir, harness.executable))) {
      pathAddition = binDir;
    }
  }

  io.stdout.write(`${harness.name} installed. Reload your shell (or open a new one) to use the \`${harness.executable}\` command, then run: zro launch ${harness.id}\n`);
  return { code: 0, pathAddition };
}

/** Quote a single shell argument for `bash -c`. */
function shellQuote(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_./:=%@,+:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Used by `zro launch <tool> --install`: if the harness binary is not on the
 * global PATH (or not installed via npm), install its latest version, then let
 * the launch proceed. Returns true when the harness is ready to launch (whether
 * it was already installed or just installed here), false on failure.
 */
export async function ensureHarnessInstalled(
  tool: string,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const installed = await harnessBinaryInstalled(tool, io, env);
  if (installed) return true;

  const harness = resolveHarness(tool, io);
  if (!harness) return false;

  // Curl-installer harnesses link the binary into a dir (e.g. ~/.local/bin)
  // that the installer adds to ~/.bashrc for future shells — not this process.
  // Run the installer, then, if the binary still isn't on PATH but is now on
  // disk in the installer's bin dir, prepend that dir to PATH so the launch in
  // this same call resolves it without a shell reload.
  if (harness.installer) {
    const result = await runInstallerHarness(harness, io, env);
    if (result.code !== 0) return false;
    if (result.pathAddition) {
      prependPath(env, result.pathAddition);
    }
    return true;
  }

  const code = await installHarness(harness, {}, io, env);
  return code === 0;
}

/** Prepend a directory to PATH on the given env, in place. */
function prependPath(env: NodeJS.ProcessEnv, dir: string): void {
  const existing = env.PATH ?? "";
  env.PATH = existing ? `${dir}:${existing}` : dir;
}

/** True when the harness's binary is resolvable on PATH or installed globally via npm. */
async function harnessBinaryInstalled(
  tool: string,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const harness = TOOLS.find((entry) => entry.id === tool);
  if (!harness) return false;
  // A globally installed npm package owning the binary counts as installed
  // even when PATH lookup would miss (e.g. a non-interactive shell).
  if (await installedBinaryVersion(harness.executable, io, env)) return true;
  return Boolean(await findOnPath(harness.executable, io, env));
}

async function installHarness(
  harness: ToolDescriptor,
  options: InstallHarnessOptions,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<number> {
  // Curl-installer harnesses (e.g. Hermes) bypass npm entirely.
  if (harness.installer) {
    if (options.version) {
      io.stderr.write(`${harness.name} does not support --version; it always installs the latest release.\n`);
      return 1;
    }
    if (options.upgrade) {
      // The installer is idempotent and updates in place, so an upgrade is just
      // a re-run — but only when an update is actually available is reported by
      // `upgradeInstallerHarness` to mirror the npm harness up-to-date message.
      return upgradeInstallerHarness(harness, io, env);
    }
    const result = await runInstallerHarness(harness, io, env);
    return result.code;
  }

  const resolveVersion = io.resolvePackageVersion ?? resolvePackageVersion;

  // Below this point the harness is npm-installed (installer harnesses returned
  // above), so its `package` spec is present.
  const npmHarness = harness as ToolDescriptor & { package: string };

  // A pinned version (from `--version <tag>` or `<tool>@<tag>`) is verified
  // against the registry before invoking npm, so a typo yields a clean
  // "version not found" message instead of npm's raw error. A pinned version
  // takes precedence over `--upgrade` (which would otherwise pick `latest`).
  if (options.version) {
    const packageName = stripVersionSpec(npmHarness.package);
    const result = await resolveVersion(packageName, options.version);
    if (!result.found) {
      io.stderr.write(`version not found: ${options.version} for ${packageName}\n`);
      return 1;
    }
    return runInstall(npmHarness, `${packageName}@${result.version}`, io, env);
  }

  // `--upgrade` checks the installed version against the registry latest and
  // installs only if a newer one is available.
  if (options.upgrade) {
    return upgradeHarness(npmHarness, resolveVersion, io, env);
  }

  // No version pin and no upgrade: install the harness's default spec (which
  // is normally `@latest`).
  return runInstall(npmHarness, npmHarness.package, io, env);
}

/** Strip a trailing `@tag` from an npm spec, preserving scoped names like `@scope/pkg`. */
function stripVersionSpec(pkg: string): string {
  const scopedMatch = pkg.match(/^(@[^/]+\/[^@]+)@(.+)$/);
  if (scopedMatch) return scopedMatch[1];
  const plainMatch = pkg.match(/^([^@]+)@(.+)$/);
  if (plainMatch) return plainMatch[1];
  return pkg;
}

async function upgradeHarness(
  harness: { id: string; name: string; package: string; executable: string },
  resolveVersion: (packageName: string, version: string) => Promise<VersionCheck>,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const packageName = stripVersionSpec(harness.package);
  const result = await resolveVersion(packageName, "latest");
  if (!result.found) {
    io.stderr.write(`Could not check for updates to ${harness.name}: unable to reach the npm registry.\n`);
    return 1;
  }
  const latest = result.version;

  const installed = await installedBinaryVersion(harness.executable, io, env);
  if (installed && compareVersions(installed, latest) >= 0) {
    io.stdout.write(`${harness.name} is up to date (${installed}).\n`);
    return 0;
  }

  const spec = `${packageName}@${latest}`;
  io.stdout.write(
    installed
      ? `Updating ${harness.name} ${installed} → ${latest}...\n`
      : `Installing ${harness.name} (${latest})...\n`
  );
  return runInstall(harness, spec, io, env, "Updated");
}

/**
 * Upgrade a curl-installer harness (e.g. Hermes). The installer is idempotent
 * and updates in place, so an upgrade is a re-run. Unlike npm harnesses we
 * can't cheaply compare against a registry "latest", so we re-run the installer
 * unconditionally and report a reinstalled/updated message.
 */
async function upgradeInstallerHarness(
  harness: ToolDescriptor,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const installed = await installedBinaryVersion(harness.executable, io, env)
    ?? (await findOnPath(harness.executable, io, env) ? "installed" : null);
  io.stdout.write(
    installed
      ? `Reinstalling ${harness.name} to pull the latest release...\n`
      : `Installing ${harness.name}...\n`
  );
  const result = await runInstallerHarness(harness, io, env);
  return result.code;
}

/** Query `npm ls -g` for the installed version of a package owning the binary. */
async function installedBinaryVersion(
  binary: string,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  // `npm ls -g --json` lists every globally installed package with its version.
  // We match by the binary the harness exposes; the owning package is the one
  // whose `bin` field exposes it. The plain `npm ls` output doesn't include
  // `bin`, so we fall back to scanning global node_modules for the binary.
  const packageName = await findGlobalPackageByBinary(binary, io, env);
  if (!packageName) return null;

  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  try {
    const stdout = await captureSpawn(spawn, "npm", ["ls", "-g", packageName, "--json"], {
      cwd: io.cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const data = JSON.parse(stdout) as { dependencies?: Record<string, { version?: string }> };
    return data.dependencies?.[packageName]?.version ?? null;
  } catch {
    return null;
  }
}

async function findGlobalPackageByBinary(
  binary: string,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const globalRoot = await globalModulesRoot(io, env);
  if (!globalRoot) return null;
  try {
    for (const entry of await fs.readdir(globalRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = entry.name.startsWith("@")
        ? path.join(globalRoot, entry.name)
        : null;
      if (dir) {
        for (const sub of await fs.readdir(dir, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          if (await packageExposesBinary(path.join(dir, sub.name), binary)) {
            return `${entry.name}/${sub.name}`;
          }
        }
      } else if (await packageExposesBinary(path.join(globalRoot, entry.name), binary)) {
        return entry.name;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function globalModulesRoot(io: RunIo, env: NodeJS.ProcessEnv): Promise<string | null> {
  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  try {
    const stdout = await captureSpawn(spawn, "npm", ["root", "-g"], {
      cwd: io.cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function packageExposesBinary(pkgDir: string, binary: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8")) as {
      bin?: Record<string, string> | string;
    };
    if (!pkg.bin) return false;
    if (typeof pkg.bin === "string") return path.basename(pkg.bin) === binary;
    return Object.prototype.hasOwnProperty.call(pkg.bin, binary);
  } catch {
    return false;
  }
}

async function captureSpawn(
  spawn: SpawnProcess,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "ignore"] }
): Promise<string> {
  const child = spawn(command, args, options as unknown as SpawnOptions);
  const stdout = (child as ChildProcess).stdout;
  if (!stdout) throw new Error(`No stdout captured from ${command}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stdout) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Check whether a binary is resolvable on PATH via `command -v` / `where`. */
async function findOnPath(
  binary: string,
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  // `codex-app` launches via the `codex` binary with an `app` subcommand, so
  // its presence is really the codex binary's presence.
  const lookup = binary.includes(" ") ? binary.split(" ")[0] : binary;
  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  const command = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [lookup] : ["-v", lookup];
  try {
    const stdout = await captureSpawn(spawn, command, args, {
      cwd: io.cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const first = stdout.split("\n", 1)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

async function upgradeSelf(io: RunIo, env: NodeJS.ProcessEnv, version?: string): Promise<number> {
  const PACKAGE_NAME = "@moonmath-ai/zro";
  const resolveVersion = io.resolvePackageVersion ?? resolvePackageVersion;
  const currentVersion = io.currentVersion ?? io.version ?? getPackageVersion();

  let spec: string;
  if (version) {
    const result = await resolveVersion(PACKAGE_NAME, version);
    if (!result.found) {
      io.stderr.write(`version not found: ${version} for ${PACKAGE_NAME}\n`);
      return 1;
    }
    spec = `${PACKAGE_NAME}@${result.version}`;
  } else {
    const result = await resolveVersion(PACKAGE_NAME, "latest");
    if (!result.found) {
      io.stderr.write(`Could not check for updates to zro: unable to reach the npm registry.\n`);
      return 1;
    }
    if (compareVersions(currentVersion, result.version) >= 0) {
      io.stdout.write(`zro is up to date (${currentVersion}).\n`);
      return 0;
    }
    spec = `${PACKAGE_NAME}@${result.version}`;
  }

  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  const resolvedVersion = spec.slice(spec.lastIndexOf("@") + 1);
  io.stdout.write(`Upgrading ${PACKAGE_NAME} to ${resolvedVersion}...\n`);
  let installCode: number;
  try {
    installCode = await spawnAndWait(spawn, "npm", ["install", "-g", spec], {
      cwd: io.cwd,
      env,
      stdio: "inherit"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`Failed to upgrade zro (${message}).\n`);
    return 1;
  }
  if (installCode !== 0) {
    io.stderr.write(`Failed to upgrade zro (npm exited with code ${installCode}).\n`);
    return 1;
  }

  io.stdout.write("Upgrade complete. Re-launching zro...\n");
  const execPath = io.execPath ?? process.execPath;
  const scriptPath = io.scriptPath ?? process.argv[1];
  const reexecCode = await spawnAndWait(spawn, execPath, [scriptPath, "--version"], {
    cwd: io.cwd,
    env,
    stdio: "inherit"
  });
  return reexecCode;
}

async function runInstall(
  harness: { id: string; name: string },
  spec: string,
  io: RunIo,
  env: NodeJS.ProcessEnv,
  verb: "Installed" | "Updated" = "Installed"
): Promise<number> {
  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  io.stdout.write(`Installing ${harness.name} (${spec})...\n`);
  try {
    const code = await spawnAndWait(spawn, "npm", ["install", "-g", spec], {
      cwd: io.cwd,
      env,
      stdio: "inherit"
    });
    if (code !== 0) {
      io.stderr.write(`Failed to install ${harness.name} (npm exited with code ${code}).\n`);
      return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`Failed to install ${harness.name} (${message}).\n`);
    return 1;
  }

  io.stdout.write(`${verb} ${harness.name}. Run: zro launch ${harness.id}\n`);
  return 0;
}

async function spawnAndWait(
  spawn: SpawnProcess,
  command: string,
  args: string[],
  options: SpawnOptions
): Promise<number> {
  const child = spawn(command, args, options);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      resolve(1);
    });
  });
}
