import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RunIo } from "./types.js";

const DEFAULT_RELEASE_BASE = "https://github.com/moonmath-ai/zro/releases/latest/download";

function releaseBase(env: NodeJS.ProcessEnv | undefined): string {
  return env?.ZRO_UPDATE_BASE ?? DEFAULT_RELEASE_BASE;
}

export interface SelfUpdateArgs {
  currentVersion: string;
  platform: string;
  execPath: string;
}

interface ReleaseManifest {
  version: string;
  platforms: Record<string, { checksum: string; size: number }>;
}

export async function selfUpdate(args: SelfUpdateArgs, io: RunIo): Promise<number> {
  const fetcher = io.fetch ?? globalThis.fetch;
  const base = releaseBase(io.env);
  const guidance = installerGuidance(args.currentVersion);
  let manifest: ReleaseManifest;
  try {
    const response = await fetcher(`${base}/manifest.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`could not download the release manifest (HTTP ${response.status})`);
    }
    manifest = await response.json() as ReleaseManifest;
  } catch (error) {
    io.stderr.write(failure(error, guidance));
    return 1;
  }

  const comparison = compareVersions(manifest.version, args.currentVersion);
  if (comparison === 0) {
    io.stdout.write(`zro ${args.currentVersion} is up to date.\n`);
    return 0;
  }
  if (comparison < 0) {
    io.stdout.write(
      `zro ${args.currentVersion} is newer than the latest release (${manifest.version}); nothing to update.\n`,
    );
    return 0;
  }

  const entry = manifest.platforms[args.platform];
  if (!entry) {
    io.stderr.write(`The latest release (${manifest.version}) has no ${args.platform} binary.\n`);
    io.stderr.write("Install with npm instead: npm install --global @moonmath-ai/zro\n");
    return 1;
  }

  let buffer: Buffer;
  try {
    const response = await fetcher(`${base}/zro-${args.platform}`, {
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      throw new Error(`could not download the release binary (HTTP ${response.status})`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    io.stderr.write(failure(error, guidance));
    return 1;
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");
  if (buffer.byteLength !== entry.size || checksum !== entry.checksum) {
    io.stderr.write(`The downloaded update for ${args.platform} failed verification.\n`);
    io.stderr.write(guidance);
    return 1;
  }

  // Staged next to the target so the final rename stays on one filesystem and is
  // atomic; a running process keeps its open inode until it exits.
  const staging = path.join(path.dirname(args.execPath), `.zro-update-${process.pid}`);
  try {
    await fs.writeFile(staging, buffer);
    // chmod rather than writeFile's mode option, which the umask can mask.
    await fs.chmod(staging, 0o755);
    await fs.rename(staging, args.execPath);
  } catch (error) {
    await fs.rm(staging, { force: true });
    io.stderr.write(failure(error, guidance));
    return 1;
  }
  io.stdout.write(`Updated zro from ${args.currentVersion} to ${manifest.version}.\n`);
  return 0;
}

function installerGuidance(version: string): string {
  return (
    "Update it by re-running the installer:\n" +
    "    curl -fsSL https://zro.moonmath.ai/install.sh | bash\n" +
    "To install a specific version:\n" +
    `    curl -fsSL https://zro.moonmath.ai/install.sh | bash -s -- ${version}\n`
  );
}

function failure(error: unknown, guidance: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not update zro: ${message}.\n\n${guidance}`;
}

function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (aCore[index] !== bCore[index]) {
      return (aCore[index] ?? 0) < (bCore[index] ?? 0) ? -1 : 1;
    }
  }
  if (aPre === bPre) return 0;
  if (aPre === undefined) return 1;
  if (bPre === undefined) return -1;
  return comparePrerelease(aPre, bPre);
}

// Semver 11.4: numeric identifiers compare numerically and rank below
// alphanumeric ones; a shorter prerelease list ranks below a longer one.
function comparePrerelease(a: string, b: string): number {
  const aParts = a.split(".");
  const bParts = b.split(".");
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const aPart = aParts[index];
    const bPart = bParts[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) < Number(bPart) ? -1 : 1;
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

function splitVersion(version: string): [number[], string | undefined] {
  const dash = version.indexOf("-");
  const core = (dash === -1 ? version : version.slice(0, dash)).split(".").map(Number);
  const pre = dash === -1 ? undefined : version.slice(dash + 1);
  return [core, pre];
}
