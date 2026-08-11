// Build the zro CLI into a standalone binary via Node SEA (Single Executable Application).
//
// Usage:
//   node scripts/build-binary.mjs --target darwin-arm64
//   node scripts/build-binary.mjs --target linux-x64 --node-path /path/to/node
//
// Targets: darwin-arm64, darwin-x64, linux-x64, linux-arm64
//   (Windows is intentionally unsupported: src/run.ts rejects win32 and the
//   package declares `"os": ["!win32"]`. Windows users install inside WSL.)
// Output:  artifacts/bin/zro-<target> + artifacts/bin/SHA256SUMS row
//
// The Node binary used as the SEA host must match the target platform. On CI each
// matrix leg runs this script on the matching OS, so process.execPath is correct
// and no postject signing quirks are needed (we strip the macOS signature instead).

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const TARGETS = {
  "darwin-arm64": { platform: "darwin", arch: "arm64", ext: "" },
  "darwin-x64": { platform: "darwin", arch: "x64", ext: "" },
  "linux-x64": { platform: "linux", arch: "x64", ext: "" },
  "linux-arm64": { platform: "linux", arch: "arm64", ext: "" },
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const target = arg("target");
const nodePath = arg("node-path") ?? process.execPath;
const outDir = resolve(root, arg("out-dir") ?? "artifacts/bin");

if (!TARGETS[target]) {
  console.error(`Unknown --target "${target}". Expected one of: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const { platform, arch, ext } = TARGETS[target];

if (process.platform !== platform) {
  console.error(
    `Cross-compiling SEA binaries across operating systems is not supported.\n` +
      `Run this script on a ${platform} host (or CI runner) for --target ${target}.`,
  );
  process.exit(1);
}

const workDir = resolve(root, "artifacts/sea-work");
mkdirSync(workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// 1. Type-check-free bundle: compile TS -> single CJS file with deps inlined.
//    SEA's `main` is loaded as CJS regardless of package "type", so we bundle
//    everything (json5, yaml) into a single .cjs.
// The version is baked in via a global define (see src/run.ts) because the SEA
// bundle has no real __dirname/__filename at runtime.
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const bundlePath = resolve(workDir, "cli.cjs");
await build({
  entryPoints: [resolve(root, "src/cli.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // No shebang banner: the SEA main script is parsed as a module body, so a
  // leading "#!" is a syntax error. src/cli.ts already invokes run().
  define: {
    "globalThis.__ZRO_PACKAGE_VERSION__": JSON.stringify(pkg.version),
  },
  logLevel: "warning",
});

console.log(`Bundled ${bundlePath}`);

// 2. SEA config.
const seaConfigPath = resolve(workDir, "sea-config.json");
writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: resolve(workDir, "sea-prep.blob"),
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  ),
);

// 3. Generate the SEA blob. Must use the same Node build that will host the
//    blob (V8 embeds a version check), so we invoke the *target* node binary.
execFileSync(nodePath, ["--experimental-sea-config", seaConfigPath], {
  stdio: "inherit",
});

// 4. Copy the host node binary for the target and inject the blob.
const outName = `zro-${target}${ext}`;
const outPath = resolve(outDir, outName);
copyFileSync(nodePath, outPath);
chmodSync(outPath, 0o755);

// postject is invoked through its own CLI so we don't take a runtime dep on its API.
const postjectBin = require.resolve("postject/dist/cli.js");
// Modern Node.js binaries (>= v20) embed the SEA sentinel as NODE_SEA_FUSE_*,
// not the older POSTJECT_SENTINEL_* string. We pass it explicitly so postject
// can locate the fuse to flip.
const sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const sentinel = "NODE_SEA_BLOB";
const machoSegment = platform === "darwin" ? "NODE_SEA" : undefined;

// On macOS the copied binary is signed; injection changes its contents, so strip
// the signature first and let the user's machine re-validate on first run.
if (platform === "darwin") {
  try {
    execFileSync("codesign", ["--remove-signature", outPath], { stdio: "inherit" });
  } catch {
    // Unsigned already; fine.
  }
}

const postjectArgs = [
  postjectBin,
  outPath,
  sentinel,
  resolve(workDir, "sea-prep.blob"),
  "--overwrite",
  "--sentinel-fuse",
  sentinelFuse,
];
if (machoSegment) postjectArgs.push("--macho-segment-name", machoSegment);

execFileSync(process.execPath, postjectArgs, { stdio: "inherit" });

// On macOS re-sign ad-hoc so Gatekeeper doesn't kill the process outright.
if (platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", outPath], { stdio: "inherit" });
}

// 5. Checksums.
const sha = createHash("sha256").update(readFileSync(outPath)).digest("hex");
const sumsPath = resolve(outDir, "SHA256SUMS");
const existing = (() => {
  try {
    return readFileSync(sumsPath, "utf8");
  } catch {
    return "";
  }
})();
const lines = existing
  .split("\n")
  .filter((l) => l.trim() && !l.endsWith(`  ${outName}`));
lines.push(`${sha}  ${outName}`);
lines.sort();
writeFileSync(sumsPath, lines.join("\n") + "\n");

rmSync(workDir, { recursive: true, force: true });

console.log(`Built ${outPath}`);
console.log(`sha256 ${sha}`);
