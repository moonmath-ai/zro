#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { readPackageVersion, repoRoot, sha256File } from "./lib/common.mjs";

const require = createRequire(import.meta.url);
const { inject } = require("postject");

const NODE_VERSION = "22.23.5";
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

// Official Node.js tarballs from https://nodejs.org/dist/v22.23.5/SHASUMS256.txt.
// linux-arm64-musl is omitted: Node.js does not publish that build.
const NODE_DIST_SHA256 = {
  "darwin-arm64": "d0c68c321161bb2c6483efea9a343010dea8e5e7f60d73c6a7eba140016d662f",
  "darwin-x64": "d68bf234a07781141dfca61ae4461c24560f70bd53223d76a41529eb02e8554e",
  "linux-arm64": "2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09",
  "linux-x64": "cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8",
  "linux-x64-musl": "aef6690916d4b4210b55618ea0beeb927d67184257879b1ebec6e309285f3c08",
};

export const PLATFORMS = {
  "darwin-arm64": { nodeDist: "darwin-arm64" },
  "darwin-x64": { nodeDist: "darwin-x64" },
  "linux-arm64": { nodeDist: "linux-arm64" },
  "linux-x64": { nodeDist: "linux-x64" },
  "linux-x64-musl": {
    nodeDist: "linux-x64-musl",
    // The musl binary cannot run on a glibc builder. Generate the blob with the
    // matching glibc Node and keep V8 code cache off; it is not portable across libc.
    runnerDist: "linux-x64",
  },
};

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? "signal"}`);
  }
}

function download(url, dest, sha256) {
  if (fs.existsSync(dest) && sha256File(dest) === sha256) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  run("curl", ["-fsSL", "-o", partial, url]);
  const actual = sha256File(partial);
  if (actual !== sha256) {
    fs.rmSync(partial, { force: true });
    throw new Error(`Checksum mismatch for ${url}: ${actual}`);
  }
  fs.renameSync(partial, dest);
}

function nodeBinary(distName, tarball, workDir) {
  const folder = `node-v${NODE_VERSION}-${distName}`;
  const binary = path.join(workDir, folder, "bin", "node");
  if (!fs.existsSync(binary)) {
    fs.mkdirSync(workDir, { recursive: true });
    run("tar", ["-xf", tarball, "-C", workDir, `${folder}/bin/node`]);
  }
  fs.chmodSync(binary, 0o755);
  return binary;
}

async function bundle(version) {
  const outfile = path.join(repoRoot, "dist", "sea", "zro.cjs");
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(repoRoot, "src", "cli.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile,
    legalComments: "none",
    define: {
      __ZRO_VERSION__: JSON.stringify(version),
    },
    plugins: [{
      name: "inline-version",
      setup(build) {
        // package.json is not inside the SEA blob; the version is inlined instead.
        // Match the resolved module, not the importer, so every first-party
        // import of version.js gets the stub, not just run.ts.
        build.onResolve({ filter: /\/version\.js$/ }, (args) => {
          if (args.resolveDir && path.resolve(args.resolveDir, args.path) === path.join(repoRoot, "src", "version.js")) {
            return { path: path.join(repoRoot, "scripts", "sea-version-stub.js") };
          }
          return null;
        });
      },
    }],
    logLevel: "warning",
  });
  return outfile;
}

async function buildPlatform(platform, bundlePath) {
  const spec = PLATFORMS[platform];
  if (!spec) {
    throw new Error(`Unknown platform "${platform}". Choose: ${Object.keys(PLATFORMS).join(", ")}.`);
  }
  const host = `${process.platform}-${process.arch}`;
  const runnerDist = spec.runnerDist ?? spec.nodeDist;
  if (host !== runnerDist) {
    throw new Error(`Build ${platform} on ${runnerDist}. This machine is ${host}.`);
  }

  const cacheDir = path.join(repoRoot, "dist", "sea", "cache");
  const workDir = path.join(repoRoot, "dist", "sea", "work", platform);
  fs.mkdirSync(cacheDir, { recursive: true });

  const targetArchive = path.join(cacheDir, `node-v${NODE_VERSION}-${spec.nodeDist}.tar.xz`);
  download(
    `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${spec.nodeDist}.tar.xz`,
    targetArchive,
    NODE_DIST_SHA256[spec.nodeDist],
  );
  const targetNode = nodeBinary(spec.nodeDist, targetArchive, workDir);

  let runnerNode = targetNode;
  if (spec.runnerDist) {
    const runnerArchive = path.join(cacheDir, `node-v${NODE_VERSION}-${spec.runnerDist}.tar.xz`);
    download(
      `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${spec.runnerDist}.tar.xz`,
      runnerArchive,
      NODE_DIST_SHA256[spec.runnerDist],
    );
    runnerNode = nodeBinary(spec.runnerDist, runnerArchive, path.join(repoRoot, "dist", "sea", "work", spec.runnerDist));
  }

  const versionCheck = spawnSync(runnerNode, ["--version"], { encoding: "utf8" });
  if (versionCheck.stdout?.trim() !== `v${NODE_VERSION}`) {
    throw new Error(`Expected Node v${NODE_VERSION}, got ${versionCheck.stdout?.trim() || versionCheck.stderr}`);
  }

  const blobPath = path.join(workDir, "sea-prep.blob");
  const configPath = path.join(workDir, "sea-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    // Code cache is produced by the runner binary and only loads in that same build.
    useCodeCache: !spec.runnerDist,
  }));
  run(runnerNode, ["--experimental-sea-config", configPath]);

  const output = path.join(repoRoot, "dist", "sea", `zro-${platform}`);
  fs.copyFileSync(targetNode, output);
  fs.chmodSync(output, 0o755);
  const darwin = spec.nodeDist.startsWith("darwin-");
  if (darwin) run("codesign", ["--remove-signature", output]);
  await inject(output, "NODE_SEA_BLOB", fs.readFileSync(blobPath), {
    sentinelFuse: FUSE,
    overwrite: true,
    ...(darwin ? { machoSegmentName: "NODE_SEA" } : {}),
  });
  if (darwin) run("codesign", ["--sign", "-", output]);
  console.log(output);
}

async function main() {
  const platforms = process.argv.slice(2).filter((arg) => arg !== "--");
  if (platforms.length === 0 || platforms.includes("--help") || platforms.includes("-h")) {
    console.error(`Usage: node scripts/build-sea.mjs <platform> [platform...]`);
    console.error(`Platforms: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(platforms.includes("--help") || platforms.includes("-h") ? 0 : 1);
  }
  const bundlePath = await bundle(readPackageVersion());
  for (const platform of platforms) {
    await buildPlatform(platform, bundlePath);
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
