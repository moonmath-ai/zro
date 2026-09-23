import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", path.join(root, "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
});

if (process.platform !== "win32") {
  fs.chmodSync(path.join(root, "dist", "cli.js"), 0o755);
}
