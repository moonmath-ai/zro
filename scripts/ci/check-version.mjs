#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gt, valid } from "semver";

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

if (!valid(candidate)) {
  console.error(`Invalid version "${candidate}" in package.json.`);
  process.exit(1);
}

const latest = latestPublished();
console.log(`candidate: ${candidate}`);
console.log(`latest released: ${latest ?? "(none)"}`);

if (latest && !gt(candidate, latest)) {
  console.error(
    `Version ${candidate} is not greater than the latest released version ${latest}. ` +
    "Bump the version in package.json."
  );
  process.exit(1);
}

console.log(`Version ${candidate} is greater than the latest released version ${latest ?? "n/a"}.`);