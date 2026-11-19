import fs from "node:fs";

export function readInstalledPackageVersion(): string {
  const raw = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}
