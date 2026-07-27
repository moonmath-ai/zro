import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { clearScreenDown, emitKeypressEvents, moveCursor } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import type { SpawnOptions, SpawnProcess } from "./engine/types.js";

const PACKAGE_NAME = "@moonmath-ai/zro";
const INSTALL_COMMAND = `npm install -g ${PACKAGE_NAME}@latest`;
const NPM_REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const NPM_REGISTRY_BASE = "https://registry.npmjs.org";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPGRADE_CHOICES = ["Upgrade now", "Skip for now", "Skip until next version"] as const;
type UpgradeChoice = (typeof UPGRADE_CHOICES)[number];

function choiceLabel(choice: UpgradeChoice): string {
  if (choice === "Upgrade now") return `Upgrade now (runs: ${INSTALL_COMMAND})`;
  return choice;
}

interface UpgradeCache {
  lastCheckedAt: string | null;
  latestVersion: string | null;
  skippedVersion: string | null;
}

interface CheckUpgradeOptions {
  currentVersion: string;
  homeDir: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  spawn?: SpawnProcess;
  fetchLatestVersion?: () => Promise<string | null>;
  execPath?: string;
  scriptPath?: string;
  argv: string[];
}

export type UpgradeCheckResult =
  | { proceed: true }
  | { proceed: false; exitCode: number };

export async function checkUpgrade(options: CheckUpgradeOptions): Promise<UpgradeCheckResult> {
  if (!options.fetchLatestVersion) return { proceed: true };

  const env = options.env ?? process.env;
  let cache: UpgradeCache = { lastCheckedAt: null, latestVersion: null, skippedVersion: null };
  try {
    cache = await readUpgradeCache(options.homeDir, env);
  } catch {
    cache = { lastCheckedAt: null, latestVersion: null, skippedVersion: null };
  }

  const now = Date.now();
  const lastChecked = cache.lastCheckedAt ? Date.parse(cache.lastCheckedAt) : NaN;
  const cacheFresh = !Number.isNaN(lastChecked) && now - lastChecked < CHECK_INTERVAL_MS;

  let latestVersion: string | null;
  if (cacheFresh && cache.latestVersion !== null) {
    latestVersion = cache.latestVersion;
  } else {
    try {
      latestVersion = await options.fetchLatestVersion();
    } catch {
      latestVersion = null;
    }
    try {
      await writeUpgradeCache(options.homeDir, env, {
        lastCheckedAt: new Date(now).toISOString(),
        latestVersion,
        skippedVersion: cache.skippedVersion
      });
    } catch {
      // Cache write failure is advisory — don't block the launch.
    }
  }

  if (!latestVersion) return { proceed: true };

  if (compareVersions(options.currentVersion, latestVersion) >= 0) {
    return { proceed: true };
  }

  if (cache.skippedVersion === latestVersion) {
    return { proceed: true };
  }

  if (!isTty(options.stdin) || !isTty(options.stdout)) {
    options.stderr.write(
      `zro ${options.currentVersion} is out of date. Latest: ${latestVersion}.\n` +
      `Run \`npm install -g ${PACKAGE_NAME}@latest\` to upgrade.\n`
    );
    return { proceed: true };
  }

  let choice: UpgradeChoice;
  try {
    choice = await promptUpgrade(options.stdin, options.stdout, {
      currentVersion: options.currentVersion,
      latestVersion
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.stderr.write(`${message}\n`);
    return { proceed: false, exitCode: 1 };
  }

  switch (choice) {
    case "Upgrade now":
      return performUpgrade(options, latestVersion, env);
    case "Skip for now":
      return { proceed: true };
    case "Skip until next version": {
      try {
        await writeUpgradeCache(options.homeDir, env, {
          lastCheckedAt: new Date(now).toISOString(),
          latestVersion,
          skippedVersion: latestVersion
        });
      } catch {
        // Cache write failure is advisory — don't block the launch.
      }
      return { proceed: true };
    }
  }
}

async function performUpgrade(
  options: CheckUpgradeOptions,
  latestVersion: string,
  env: NodeJS.ProcessEnv
): Promise<UpgradeCheckResult> {
  const spawn = options.spawn ?? (nodeSpawn as SpawnProcess);

  options.stdout.write(`Upgrading ${PACKAGE_NAME} to ${latestVersion}...\n`);
  let installCode: number;
  try {
    installCode = await spawnAndWait(spawn, "npm", ["install", "-g", `${PACKAGE_NAME}@latest`], {
      cwd: options.cwd,
      env,
      stdio: "inherit"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.stderr.write(`Failed to upgrade (${message}). Continuing with ${options.currentVersion}.\n`);
    return { proceed: true };
  }

  if (installCode !== 0) {
    options.stderr.write(`Failed to upgrade (npm exited with code ${installCode}). Continuing with ${options.currentVersion}.\n`);
    return { proceed: true };
  }

  options.stdout.write("Upgrade complete. Re-launching zro...\n");

  const execPath = options.execPath ?? process.execPath;
  const scriptPath = options.scriptPath ?? process.argv[1];
  let reexecCode: number;
  try {
    reexecCode = await spawnAndWait(spawn, execPath, [scriptPath, ...options.argv], {
      cwd: options.cwd,
      env,
      stdio: "inherit"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.stderr.write(`Failed to re-launch zro after upgrade (${message}). Continuing with ${options.currentVersion}.\n`);
    return { proceed: true };
  }

  return { proceed: false, exitCode: reexecCode };
}

function spawnAndWait(
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

interface PromptOptions {
  currentVersion: string;
  latestVersion: string;
}

async function promptUpgrade(
  stdin: Readable,
  stdout: Writable,
  options: PromptOptions
): Promise<UpgradeChoice> {
  const input = stdin as Readable & {
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const previousRawMode = input.isRaw;
  let selectedIndex = 0;
  let typed = "";
  let renderedLines = 0;
  let message = "";

  input.setRawMode?.(true);
  input.resume();
  emitKeypressEvents(input);

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (typeof previousRawMode === "boolean") input.setRawMode?.(previousRawMode);
      input.pause();
    };

    const finish = (choice: UpgradeChoice) => {
      if (settled) return;
      settled = true;
      stdout.write("\n");
      cleanup();
      resolve(choice);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stdout.write("\n");
      cleanup();
      reject(error);
    };

    const render = () => {
      if (renderedLines > 0) {
        moveCursor(stdout, 0, -renderedLines);
        clearScreenDown(stdout);
      }

      stdout.write(`🚀 Update available: ${options.currentVersion} → ${options.latestVersion}\n\n`);
      stdout.write("What would you like to do?\n");
      for (let index = 0; index < UPGRADE_CHOICES.length; index += 1) {
        const marker = index === selectedIndex ? ">" : " ";
        stdout.write(`${marker} ${index + 1}. ${choiceLabel(UPGRADE_CHOICES[index])}\n`);
      }

      const typedText = typed ? ` Typed: ${typed}` : "";
      stdout.write(`Use Up/Down, Enter to select. Type 1-${UPGRADE_CHOICES.length}.${typedText}\n`);
      if (message) stdout.write(`${message}\n`);
      renderedLines = UPGRADE_CHOICES.length + 4 + (message ? 1 : 0);
    };

    const chooseTyped = () => {
      const answer = typed.trim();
      if (!answer) {
        finish(UPGRADE_CHOICES[selectedIndex]);
        return;
      }

      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= UPGRADE_CHOICES.length) {
        finish(UPGRADE_CHOICES[index - 1]);
        return;
      }

      typed = "";
      message = `Choose 1-${UPGRADE_CHOICES.length}.`;
      render();
    };

    function onKeypress(text: string, key: { ctrl?: boolean; name?: string }) {
      message = "";
      if (key.ctrl && key.name === "c") {
        fail(new Error("Interrupted while selecting upgrade option."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        chooseTyped();
        return;
      }

      if (key.name === "up") {
        typed = "";
        selectedIndex = (selectedIndex - 1 + UPGRADE_CHOICES.length) % UPGRADE_CHOICES.length;
        render();
        return;
      }

      if (key.name === "down") {
        typed = "";
        selectedIndex = (selectedIndex + 1) % UPGRADE_CHOICES.length;
        render();
        return;
      }

      if (key.name === "backspace") {
        typed = typed.slice(0, -1);
        render();
        return;
      }

      if (/^[1-3]$/.test(text)) {
        typed += text;
        const numericIndex = Number(typed);
        if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= UPGRADE_CHOICES.length) {
          selectedIndex = numericIndex - 1;
        }
        render();
      }
    }

    input.on("keypress", onKeypress);
    render();
  });
}

export async function defaultFetchLatestVersion(): Promise<string | null> {
  const response = await fetch(NPM_REGISTRY_LATEST_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { version?: unknown };
  return typeof data.version === "string" ? data.version : null;
}

interface NpmPackument {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, unknown>;
}

async function fetchPackument(packageName: string): Promise<NpmPackument | null> {
  const response = await fetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return null;
  return (await response.json()) as NpmPackument;
}

export type VersionCheck =
  | { found: true; version: string }
  | { found: false };

/**
 * Resolve a version or dist-tag for an npm package against the registry.
 * Recognises dist-tags (e.g. "latest") and exact versions. A bare "latest"
 * resolves to the package's `latest` dist-tag, which is distinct from omitting
 * a version (which keeps the package's existing `@latest` spec).
 */
export async function resolvePackageVersion(
  packageName: string,
  version: string,
  fetcher: (pkg: string) => Promise<NpmPackument | null> = fetchPackument
): Promise<VersionCheck> {
  const packument = await fetcher(packageName);
  if (!packument) return { found: false };

  const distTags = packument["dist-tags"] ?? {};
  if (typeof distTags[version] === "string") {
    return { found: true, version: distTags[version] };
  }

  const versions = packument.versions ?? {};
  if (Object.prototype.hasOwnProperty.call(versions, version)) {
    return { found: true, version };
  }

  return { found: false };
}

export function getPackageVersion(): string {
  const packageJsonPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json"
  );
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function upgradeCacheFilePath(homeDir: string, env?: NodeJS.ProcessEnv): string {
  const configRoot = env?.XDG_CONFIG_HOME || path.join(homeDir, ".config");
  return path.join(configRoot, "zro", "upgrade-check.json");
}

async function readUpgradeCache(homeDir: string, env?: NodeJS.ProcessEnv): Promise<UpgradeCache> {
  const filePath = upgradeCacheFilePath(homeDir, env);
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as Partial<UpgradeCache>;
    return {
      lastCheckedAt: typeof parsed.lastCheckedAt === "string" ? parsed.lastCheckedAt : null,
      latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : null,
      skippedVersion: typeof parsed.skippedVersion === "string" ? parsed.skippedVersion : null
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { lastCheckedAt: null, latestVersion: null, skippedVersion: null };
    }
    if (error instanceof SyntaxError) {
      return { lastCheckedAt: null, latestVersion: null, skippedVersion: null };
    }
    throw error;
  }
}

async function writeUpgradeCache(
  homeDir: string,
  env: NodeJS.ProcessEnv | undefined,
  cache: UpgradeCache
): Promise<void> {
  const filePath = upgradeCacheFilePath(homeDir, env);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, "").split(".").map(Number);
  const partsB = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const partA = partsA[i] ?? 0;
    const partB = partsB[i] ?? 0;
    if (partA < partB) return -1;
    if (partA > partB) return 1;
  }
  return 0;
}

function isTty(stream: Readable | Writable): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
