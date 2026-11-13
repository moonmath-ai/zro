import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { selfUpdate } from "../src/selfupdate.js";
import type { RunIo } from "../src/types.js";

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function makeIo(fetch: NonNullable<RunIo["fetch"]>): { io: RunIo; stdout: PassThrough; stderr: PassThrough } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return {
    io: { stdin: new PassThrough(), stdout, stderr, homeDir: os.tmpdir(), cwd: os.tmpdir(), fetch },
    stdout,
    stderr,
  };
}

function manifestFetcher(manifest: unknown, binary?: string): NonNullable<RunIo["fetch"]> {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/manifest.json")) return Response.json(manifest);
    if (binary !== undefined && url.endsWith("/zro-linux-x64")) return new Response(binary);
    throw new Error(`unexpected fetch: ${url}`);
  };
}

async function text(stream: PassThrough): Promise<string> {
  stream.end();
  let result = "";
  for await (const chunk of stream) result += chunk.toString();
  return result;
}

async function makeExecPath(contents = "old-binary"): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zro-selfupdate-"));
  const execPath = path.join(directory, "zro");
  await fs.writeFile(execPath, contents);
  return execPath;
}

async function stagingLeftovers(execPath: string): Promise<string[]> {
  const names = await fs.readdir(path.dirname(execPath));
  return names.filter((name) => name.startsWith(".zro-update"));
}

describe("selfUpdate", () => {
  it("downloads, verifies, and atomically replaces the binary", async () => {
    const execPath = await makeExecPath();
    const { io, stdout } = makeIo(manifestFetcher(
      { version: "0.5.0", platforms: { "linux-x64": { checksum: sha256("new-binary"), size: 10 } } },
      "new-binary",
    ));

    expect(await selfUpdate({ currentVersion: "0.4.2", platform: "linux-x64", execPath }, io)).toBe(0);

    expect(await fs.readFile(execPath, "utf8")).toBe("new-binary");
    expect((await fs.stat(execPath)).mode & 0o111).toBe(0o111);
    expect(await text(stdout)).toContain("Updated zro from 0.4.2 to 0.5.0.");
    expect(await stagingLeftovers(execPath)).toEqual([]);
  });

  it("is a no-op when already up to date", async () => {
    const execPath = await makeExecPath();
    const { io, stdout } = makeIo(manifestFetcher({ version: "0.4.2", platforms: {} }));

    expect(await selfUpdate({ currentVersion: "0.4.2", platform: "linux-x64", execPath }, io)).toBe(0);

    expect(await text(stdout)).toContain("zro 0.4.2 is up to date.");
    expect(await fs.readFile(execPath, "utf8")).toBe("old-binary");
  });

  it("does not downgrade a binary newer than the latest release", async () => {
    const execPath = await makeExecPath();
    const { io, stdout } = makeIo(manifestFetcher({ version: "0.4.2", platforms: {} }));

    expect(await selfUpdate({ currentVersion: "0.5.0", platform: "linux-x64", execPath }, io)).toBe(0);

    expect(await text(stdout)).toContain("newer than the latest release (0.4.2)");
    expect(await fs.readFile(execPath, "utf8")).toBe("old-binary");
  });

  it("updates across numeric prerelease iterations", async () => {
    const execPath = await makeExecPath();
    const { io, stdout } = makeIo(manifestFetcher(
      { version: "0.5.0-rc.10", platforms: { "linux-x64": { checksum: sha256("new-binary"), size: 10 } } },
      "new-binary",
    ));

    expect(await selfUpdate({ currentVersion: "0.5.0-rc.2", platform: "linux-x64", execPath }, io)).toBe(0);

    expect(await text(stdout)).toContain("Updated zro from 0.5.0-rc.2 to 0.5.0-rc.10.");
    expect(await fs.readFile(execPath, "utf8")).toBe("new-binary");
  });

  it("never downgrades to an older prerelease", async () => {
    const execPath = await makeExecPath();
    const { io, stdout } = makeIo(manifestFetcher({ version: "0.5.0-rc.9", platforms: {} }));

    expect(await selfUpdate({ currentVersion: "0.5.0-rc.10", platform: "linux-x64", execPath }, io)).toBe(0);

    expect(await text(stdout)).toContain("newer than the latest release (0.5.0-rc.9)");
    expect(await fs.readFile(execPath, "utf8")).toBe("old-binary");
  });

  it("rejects a failed verification and keeps the old binary", async () => {
    const execPath = await makeExecPath();
    const { io, stderr } = makeIo(manifestFetcher(
      { version: "0.5.0", platforms: { "linux-x64": { checksum: sha256("something-else"), size: 10 } } },
      "new-binary",
    ));

    expect(await selfUpdate({ currentVersion: "0.4.2", platform: "linux-x64", execPath }, io)).toBe(1);

    expect(await text(stderr)).toContain("failed verification");
    expect(await fs.readFile(execPath, "utf8")).toBe("old-binary");
    expect(await stagingLeftovers(execPath)).toEqual([]);
  });

  it("reports platforms missing from the manifest", async () => {
    const execPath = await makeExecPath();
    const { io, stderr } = makeIo(manifestFetcher({
      version: "0.5.0",
      platforms: { "darwin-arm64": { checksum: "0".repeat(64), size: 10 } },
    }));

    expect(await selfUpdate({ currentVersion: "0.4.2", platform: "linux-x64", execPath }, io)).toBe(1);

    const missing = await text(stderr);
    expect(missing).toContain("no linux-x64 binary");
    expect(missing).toContain("npm install --global @moonmath-ai/zro");
  });

  it("guides to the installer when the manifest cannot be fetched", async () => {
    const execPath = await makeExecPath();
    const { io, stderr } = makeIo(async () => new Response("not found", { status: 404 }));

    expect(await selfUpdate({ currentVersion: "0.4.2", platform: "linux-x64", execPath }, io)).toBe(1);

    const guidance = await text(stderr);
    expect(guidance).toContain("Could not update zro: could not download the release manifest (HTTP 404)");
    expect(guidance).toContain("curl -fsSL https://zro.moonmath.ai/install.sh | bash");
    expect(guidance).toContain("bash -s -- 0.4.2");
  });
});
