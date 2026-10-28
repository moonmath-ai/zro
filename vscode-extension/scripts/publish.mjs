#!/usr/bin/env node
/**
 * Publish the ZRO VS Code extension to the Marketplace.
 *
 * Usage:
 *   npm run publish                  # publish the version in package.json
 *   npm run publish -- minor         # bump minor, then publish
 *   npm run publish -- --dry-run     # validate + package, but don't upload
 *   npm run publish -- --yes         # skip the confirmation prompt
 *
 * The Marketplace PAT is read from the VSCE_PAT environment variable. When it is
 * unset, `vsce` falls back to its own interactive login flow.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST = join(ROOT, "package.json");
const ALLOWED_BUMPS = new Set(["major", "minor", "patch"]);

// ---------------------------------------------------------------------------
// console helpers
// ---------------------------------------------------------------------------

const c = {
  bold: (s) => `\u001b[1m${s}\u001b[22m`,
  dim: (s) => `\u001b[2m${s}\u001b[22m`,
  green: (s) => `\u001b[32m${s}\u001b[39m`,
  yellow: (s) => `\u001b[33m${s}\u001b[39m`,
  red: (s) => `\u001b[31m${s}\u001b[39m`,
  cyan: (s) => `\u001b[36m${s}\u001b[39m`,
};

function step(message) {
  process.stdout.write(`\n${c.cyan("▸")} ${c.bold(message)}\n`);
}

function ok(message) {
  process.stdout.write(`  ${c.green("✓")} ${message}\n`);
}

function warn(message) {
  process.stdout.write(`  ${c.yellow("!")} ${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n${c.red("✗")} ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// process helpers
// ---------------------------------------------------------------------------

/** Run a command in the extension directory, inheriting stdio. */
function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
}

/** Run a command and return its trimmed stdout. */
function capture(command, args) {
  return execSync([command, ...args].join(" "), {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function parseArgs(argv) {
  const flags = { dryRun: false, yes: false, skipTests: false, bump: null, help: false };

  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "-n") flags.dryRun = true;
    else if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--skip-tests") flags.skipTests = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (ALLOWED_BUMPS.has(arg)) flags.bump = arg;
    else fail(`Unknown argument: ${arg}\n       Run with --help for usage.`);
  }

  return flags;
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

  if (!Number.isFinite(major) || major < 18) {
    fail(`Node 18+ is required to run this script (found ${process.versions.node}).`);
  }

  ok(`Node ${process.versions.node}`);
}

/** Verify the assets referenced by the manifest actually exist on disk. */
function checkAssets(manifest) {
  const referenced = new Set();

  for (const entry of manifest.contributes?.viewsContainers?.activitybar ?? []) {
    if (entry.icon) referenced.add(entry.icon);
  }

  for (const views of Object.values(manifest.contributes?.views ?? {})) {
    for (const view of views) {
      if (view.icon) referenced.add(view.icon);
    }
  }

  if (manifest.icon) {
    referenced.add(manifest.icon);
  }

  if (referenced.size === 0) {
    warn("package.json references no icons.");
    return;
  }

  let missing = 0;

  for (const rel of referenced) {
    if (existsSync(join(ROOT, rel))) {
      ok(`asset: ${rel}`);
    } else {
      warn(`asset missing: ${rel}`);
      missing++;
    }
  }

  if (missing === referenced.size) {
    fail("None of the icons referenced by package.json exist on disk.");
  }
}

/** Warn (never fail) when the tree is dirty — publishes are permanent. */
function checkGitState() {
  try {
    const status = capture("git", ["status", "--porcelain", "--", "."]);

    if (status) {
      warn("Working tree has uncommitted changes. Publishing is permanent:");

      for (const line of status.split("\n").slice(0, 10)) {
        process.stdout.write(c.dim(`      ${line}\n`));
      }
    } else {
      ok("Working tree is clean.");
    }
  } catch {
    warn("Not a git repository (or git unavailable) — skipping the revision check.");
  }
}

/** Report metadata problems the Marketplace rejects or renders poorly. */
function checkManifest(manifest) {
  const required = ["name", "publisher", "version", "description", "engines.vscode"];
  const missing = required.filter((key) => {
    const value = key.split(".").reduce((acc, part) => acc?.[part], manifest);
    return value === undefined || value === "";
  });

  if (missing.length > 0) {
    fail(`package.json is missing required Marketplace fields: ${missing.join(", ")}`);
  }

  // vsce enforces this exact pattern (see @vscode/vsce/out/validation.js). Dots and
  // underscores are rejected — a dotted value is almost always the publisher's
  // human-friendly *Name* rather than its immutable *ID*.
  const publisherId = /^[a-z0-9][a-z0-9-]*$/i;

  if (!publisherId.test(manifest.publisher)) {
    fail(
      `Invalid publisher ID: ${JSON.stringify(manifest.publisher)}\n` +
        '       vsce only accepts [a-z0-9-], so this looks like the publisher *Name*,\n' +
        "       not its *ID*. Find the ID field at https://marketplace.visualstudio.com/manage",
    );
  }

  if (/[a-z]/.test(manifest.name) === false || !/^[a-z0-9][a-z0-9-]*$/i.test(manifest.name)) {
    fail(`Invalid extension name: ${JSON.stringify(manifest.name)} (expected [a-z0-9-])`);
  }

  ok(`publisher:  ${c.bold(manifest.publisher)}`);
  ok(`extension:  ${manifest.name} ${c.dim(`v${manifest.version}`)}`);
  ok(`display:    ${manifest.displayName ?? manifest.name}`);
  ok(`vscode:     ${manifest.engines.vscode}`);

  if (manifest.private === true) {
    fail('package.json sets "private": true — the Marketplace rejects private packages.');
  }

  if (manifest.license === "UNLICENSED") {
    warn("license is UNLICENSED — the listing will not show a license.");
  }

  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) {
    warn("No keywords — the extension will be hard to discover in search.");
  }

  if (!manifest.repository?.url) {
    warn("No repository.url — the listing will have no source link.");
  }

  if (!existsSync(join(ROOT, "CHANGELOG.md"))) {
    warn("No CHANGELOG.md — vsce warns about this and the listing shows no changelog.");
  }
}

/**
 * Warn when the README embeds relative images and the repository is not publicly
 * reachable. vsce rewrites every relative image path into a GitHub raw URL
 * derived from `repository.url` — with a private repo those all 404, so the
 * Marketplace listing renders broken images.
 */
function checkReadmeImages(manifest) {
  const readme = join(ROOT, "README.md");

  if (!existsSync(readme)) {
    return;
  }

  const source = readFileSync(readme, "utf8");
  const relative = [...source.matchAll(/!\[[^\]]*\]\((?!https?:)([^)]+)\)/g)];

  if (relative.length === 0) {
    ok("README images are absolute URLs.");
    return;
  }

  if (!manifest.repository?.url) {
    warn(`README has ${relative.length} relative image(s) and no repository.url to resolve them.`);
    return;
  }

  const slug = manifest.repository.url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^https?:\/\/github\.com\//, "");
  const probe = `https://github.com/${slug}`;

  try {
    execSync(`curl -s -o /dev/null -w "%{http_code}" -L "${probe}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .startsWith("200")
      ? ok(`README images resolve via ${probe}`)
      : warn(
          `README has ${relative.length} relative image(s) that vsce rewrites to ` +
            `github.com/${slug}/raw/... which is NOT publicly reachable.`,
        );
  } catch {
    warn(
      `README has ${relative.length} relative image(s) rewritten to github.com/${slug}/raw/... ` +
        "and the repository could not be verified as public — images may 404 on the listing.",
    );
  }
}

/** Reject a version that is already live on the Marketplace. */
function checkNotAlreadyPublished(manifest) {
  if (!process.env.VSCE_PAT) {
    warn("VSCE_PAT not set — skipping the already-published check.");
    return;
  }

  let output;

  try {
    output = capture("npx", [
      "--yes",
      "@vscode/vsce",
      "show",
      `${manifest.publisher}.${manifest.name}`,
      "--json",
    ]);
  } catch {
    warn("Could not query the Marketplace — assuming this is the first publish.");
    return;
  }

  try {
    const { versions = [] } = JSON.parse(output);

    if (versions.some((entry) => entry.version === manifest.version)) {
      fail(
        `Version ${manifest.version} is already published. ` +
          `Bump it first, e.g. ${c.bold("npm run publish -- patch")}`,
      );
    }

    ok(`Version ${manifest.version} is not yet published.`);
  } catch {
    warn("Unexpected response from the Marketplace — skipping the version check.");
  }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function bumpVersion(target) {
  const before = readManifest().version;

  step(`Bumping version (${target}) …`);

  // --no-git-tag-version: tagging the release is left to CI.
  run("npm", ["version", target, "--no-git-tag-version"]);

  const after = readManifest().version;

  ok(`${before} → ${c.bold(after)}`);

  return after;
}

function compile() {
  step("Compiling TypeScript …");
  run("npm", ["run", "compile"]);
  ok("Compiled.");
}

function test({ skipTests }) {
  if (skipTests) {
    warn("Skipping tests (--skip-tests).");
    return;
  }

  step("Running tests …");
  run("npm", ["test"]);
  ok("Tests passed.");
}

function createPackage() {
  step("Packaging …");
  run("npm", ["run", "package"]);

  const vsix = readdirSync(ROOT)
    .filter((file) => file.endsWith(".vsix"))
    .map((file) => ({ name: file, time: statSync(join(ROOT, file)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0];

  if (!vsix) {
    fail("vsce did not produce a .vsix file.");
  }

  const sizeKb = Math.round(statSync(join(ROOT, vsix.name)).size / 1024);

  ok(`${vsix.name} (${sizeKb} KB)`);

  if (sizeKb > 1024) {
    warn("The .vsix is over 1 MB — check .vscodeignore for leaked files.");
  }

  return vsix.name;
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

async function confirm(manifest) {
  if (!process.stdin.isTTY) {
    warn("stdin is not a TTY — continuing without confirmation.");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const answer = await rl.question(
    `\nPublish ${c.bold(`${manifest.publisher}.${manifest.name}`)}@${c.bold(manifest.version)} ` +
      "to the Marketplace? [y/N] ",
  );

  rl.close();

  if (!/^y(es)?$/i.test(answer.trim())) {
    process.stdout.write("\nAborted.\n");
    process.exit(0);
  }
}

function upload({ dryRun }) {
  if (dryRun) {
    step("Dry run — skipping upload.");
    warn("Re-run without --dry-run to publish.");
    return;
  }

  step("Publishing to the Marketplace …");

  const args = ["--yes", "@vscode/vsce", "publish", "--no-dependencies"];

  if (process.env.VSCE_PAT) {
    args.push("--pat", process.env.VSCE_PAT);
  } else {
    warn("VSCE_PAT not set — vsce will prompt you to log in.");
  }

  run("npx", args);
  ok("Published.");
}

function showHelp() {
  process.stdout.write(`
${c.bold("Publish the ZRO VS Code extension")}

  ${c.bold("Usage")}
    npm run publish [bump] [options]

  ${c.bold("Arguments")}
    major | minor | patch     Bump the version before publishing.

  ${c.bold("Options")}
    -n, --dry-run             Validate and package, but do not upload.
    -y, --yes                 Skip the confirmation prompt.
        --skip-tests          Skip the test suite.
    -h, --help                Show this message.

  ${c.bold("Environment")}
    VSCE_PAT                  Marketplace PAT. When unset, vsce prompts for login.

  ${c.bold("Examples")}
    npm run publish                  ${c.dim("# publish the current version")}
    npm run publish -- patch         ${c.dim("# bump patch, then publish")}
    npm run publish -- --dry-run     ${c.dim("# check the package without uploading")}
`);
}

// ---------------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    showHelp();
    return;
  }

  process.stdout.write(c.bold("\nZRO extension publisher\n"));

  step("Preflight …");
  checkNodeVersion();

  let manifest = readManifest();
  checkManifest(manifest);
  checkAssets(manifest);
  checkReadmeImages(manifest);
  checkGitState();

  if (flags.bump) {
    bumpVersion(flags.bump);
    manifest = readManifest();
  }

  checkNotAlreadyPublished(manifest);

  compile();
  test(flags);

  const vsix = createPackage();

  await confirm(manifest);
  upload(flags);

  const listing = `https://marketplace.visualstudio.com/items?itemName=${manifest.publisher}.${manifest.name}`;

  process.stdout.write(
    flags.dryRun
      ? `\n${c.green("✓")} Dry run complete for ${c.bold(`${manifest.name} ${manifest.version}`)}` +
          ` (${vsix}).\n\n`
      : `\n${c.green("✓")} ${c.bold(`${manifest.name} ${manifest.version}`)} is live.\n` +
          `${c.dim(`  ${listing}`)}\n${c.dim(`  Artifact: ${vsix}`)}\n\n`,
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});