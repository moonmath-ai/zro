import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Single source of truth for release platforms; publish.yml's matrix must stay
// in step, and tests assert build-sea.mjs's PLATFORMS matches this list.
export const RELEASE_PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "linux-x64-musl",
];

export function sha256File(file) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
}
