import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLATFORMS } from "../scripts/build-sea.mjs";
import { RELEASE_PLATFORMS } from "../scripts/lib/common.mjs";
import { writeReleaseManifests } from "../scripts/release-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function makeReleaseDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zro-manifest-"));
  fs.writeFileSync(path.join(directory, "zro-linux-x64"), "hello");
  fs.writeFileSync(path.join(directory, "zro-linux-x64.zst"), "compressed");
  return directory;
}

describe("release manifests", () => {
  it("writes checksums and sizes for the platforms present", () => {
    const directory = makeReleaseDir();
    const { missingPlatforms } = writeReleaseManifests(directory, "0.4.2");

    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      version: "0.4.2",
      platforms: {
        "linux-x64": { checksum: sha256("hello"), size: 5 },
      },
    });

    const zstManifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.zst.json"), "utf8"));
    expect(zstManifest).toEqual({
      version: "0.4.2",
      platforms: {
        "linux-x64": { checksum: sha256("compressed") },
      },
    });

    expect(missingPlatforms).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64-musl"]);
  });

  // install.sh only runs under bash on unix-like systems.
  it.skipIf(process.platform === "win32")("the install script parses the manifest without jq", () => {
    const directory = makeReleaseDir();
    writeReleaseManifests(directory, "0.4.2");

    const parsed = spawnSync("bash", ["-c", [
      "set -euo pipefail",
      "export ZRO_INSTALL_LIB=1",
      `source ${JSON.stringify(path.join(root, "install.sh"))}`,
      'checksum=$(get_checksum_from_manifest "$MANIFEST" linux-x64)',
      'size=$(get_size_from_manifest "$MANIFEST" linux-x64)',
      'printf "%s %s\\n" "$checksum" "$size"',
    ].join("\n")], {
      encoding: "utf8",
      env: {
        ...process.env,
        MANIFEST: fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
      },
    });
    expect(parsed.status).toBe(0);
    expect(parsed.stdout.trim()).toBe(`${sha256("hello")} 5`);
  });

  it("refuses a partial release set", () => {
    const directory = makeReleaseDir();
    expect(() => writeReleaseManifests(directory, "0.4.2", { requireAll: true }))
      .toThrow(/Missing zro-darwin-arm64/);
  });

  it("CLI refuses a partial set by default", () => {
    const directory = makeReleaseDir();
    const result = spawnSync(process.execPath, [
      path.join(root, "scripts", "release-manifest.mjs"),
      directory,
    ], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Missing zro-darwin-arm64/);
  });

  it("CLI allows a partial set when asked", () => {
    const directory = makeReleaseDir();
    const result = spawnSync(process.execPath, [
      path.join(root, "scripts", "release-manifest.mjs"),
      "--allow-partial",
      directory,
    ], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/No binaries for darwin-arm64/);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    expect(manifest.platforms).toEqual({
      "linux-x64": { checksum: sha256("hello"), size: 5 },
    });
  });
});

describe("install.sh", () => {
  it.skipIf(process.platform === "win32")("is valid bash", () => {
    const result = spawnSync("bash", ["-n", path.join(root, "install.sh")], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });
});

describe("release platforms", () => {
  it("the build script and manifest generator share one platform list", () => {
    expect(Object.keys(PLATFORMS)).toEqual(RELEASE_PLATFORMS);
  });
});
