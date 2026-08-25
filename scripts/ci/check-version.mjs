#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const { name, version: candidate } = JSON.parse(readFileSync(packageJsonPath, "utf8"));

function latestPublished() {
  try {
    const output = execFileSync("npm", ["view", name, "version"], { encoding: "utf8" }).trim();
    return output || null;
  } catch {
    // The package may not have been published yet.
    return null;
  }
}

function numericParts(version) {
  // Ignore build/pre-release metadata and any leading "v".
  return version.replace(/^v/, "").split(/[-+]/)[0].split(".").map(Number);
}

function compareVersions(a, b) {
  const pa = numericParts(a);
  const pb = numericParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

const latest = latestPublished();
console.log(`candidate: ${candidate}`);
console.log(`latest released: ${latest ?? "(none)"}`);

if (latest && compareVersions(candidate, latest) <= 0) {
  console.error(
    `Version ${candidate} is not greater than the latest released version ${latest}. ` +
    "Bump the version in package.json."
  );
  process.exit(1);
}

console.log(`Version ${candidate} is greater than the latest released version ${latest ?? "n/a"}.`);