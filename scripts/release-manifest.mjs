#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_PLATFORMS, readPackageVersion, sha256File } from "./lib/common.mjs";

export function writeReleaseManifests(directory, version, options = {}) {
  const platforms = {};
  const zstPlatforms = {};
  for (const name of fs.readdirSync(directory)) {
    const compressed = name.match(/^zro-(.+)\.zst$/);
    if (compressed && RELEASE_PLATFORMS.includes(compressed[1])) {
      zstPlatforms[compressed[1]] = { checksum: sha256File(path.join(directory, name)) };
      continue;
    }
    const plain = name.match(/^zro-(.+)$/);
    if (plain && RELEASE_PLATFORMS.includes(plain[1])) {
      const file = path.join(directory, name);
      platforms[plain[1]] = {
        checksum: sha256File(file),
        size: fs.statSync(file).size,
      };
    }
  }

  const missing = RELEASE_PLATFORMS.filter(
    (platform) => !platforms[platform] || !zstPlatforms[platform],
  );
  if (options.requireAll && missing.length > 0) {
    throw new Error(
      `Missing ${missing.map((platform) => `zro-${platform} or zro-${platform}.zst`).join(", ")} in ${directory}`,
    );
  }
  if (!options.requireAll && Object.keys(platforms).length === 0) {
    throw new Error(`No zro binaries found in ${directory}`);
  }

  const ordered = (entries) => Object.fromEntries(
    RELEASE_PLATFORMS.filter((platform) => entries[platform]).map((platform) => [platform, entries[platform]]),
  );
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    `${JSON.stringify({ version, platforms: ordered(platforms) }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(directory, "manifest.zst.json"),
    `${JSON.stringify({ version, platforms: ordered(zstPlatforms) }, null, 2)}\n`,
  );
  return { missingPlatforms: missing };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = process.argv.slice(2);
  const directory = args.find((arg) => !arg.startsWith("--"));
  if (!directory) {
    console.error("Usage: node scripts/release-manifest.mjs <directory> [--allow-partial]");
    process.exit(1);
  }
  try {
    const { missingPlatforms } = writeReleaseManifests(directory, readPackageVersion(), {
      requireAll: !args.includes("--allow-partial"),
    });
    if (missingPlatforms.length > 0) {
      console.warn(`No binaries for ${missingPlatforms.join(", ")}; attaching a partial release.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
