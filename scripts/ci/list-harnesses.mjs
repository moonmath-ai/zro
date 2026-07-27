#!/usr/bin/env node
/**
 * Prints the CI harness matrix as JSON, discovered from the installed zro
 * package rather than hardcoded in the workflow YAML. Run after
 * `npm install -g <zro.tgz>` so the package is resolvable globally.
 *
 * Output: an array of { id, label, package, binary } objects.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";

const PACKAGE_NAME = "@moonmath-ai/zro";

// Node does not search the global node_modules for bare specifiers from an
// arbitrary script, so resolve the global root explicitly and require the
// compiled catalog module by absolute path.
const globalRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
if (globalRoot.status !== 0) {
  throw new Error(`Failed to locate global node_modules:\n${globalRoot.stderr}`);
}
const require = createRequire(import.meta.url);
const catalogPath = path.join(globalRoot.stdout.trim(), PACKAGE_NAME, "dist", "catalog.js");
const { TOOLS } = require(catalogPath);

// `codex-app` launches the same `@openai/codex` package as `codex`, so exclude
// it from the matrix where `codex` already covers it.
const matrix = TOOLS.filter((tool) => tool.id !== "codex-app").map(
  // Keep the matrix lean: only the fields the workflow branches on. `package`
  // is absent for curl-installed harnesses; `installer` tells the workflow
  // which official shell installer to run.
  //
  // `installer.args` is an array in the HARNESSES table (e.g. ["--skip-setup"]),
  // but GitHub Actions coerces an array interpolated via `${{ ... }}` into the
  // literal string "Array". Flatten it to a space-joined string here so the
  // workflow's `bash -s -- ${{ matrix.harness.installer.args }}` renders real
  // flags. Same for `windowsArgs` if a Windows installer step is ever added.
  ({ id, name, package: pkg, installer }) => {
    const entry = { id, label: name };
    if (pkg) entry.package = pkg;
    if (installer) {
      const { url, args, binDir } = installer;
      const flat = { url, binDir };
      if (args) flat.args = args.join(" ");
      entry.installer = flat;
    }
    return entry;
  }
);

console.log(JSON.stringify(matrix, null, 2));
