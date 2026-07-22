import type { ChildProcess } from "node:child_process";
import { constants, publicEncrypt } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { SpawnOptions, SpawnProcess } from "../src/engine/types.js";
import { run } from "../src/run.js";

describe("zro experience", () => {
  it("signs in through the website without exposing the generated key", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-web-login-"));
    const stdout = new PassThrough();
    let publicKey = "";
    let openedUrl = "";
    const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/api/cli-auth/start")) {
        const body = JSON.parse(String(init?.body)) as { publicKey: string };
        publicKey = body.publicKey;
        return Response.json({
          deviceCode: "device-secret",
          userCode: "ABCD-EFGH",
          verificationUri: "https://zro.example/cli/authorize",
          verificationUriComplete: "https://zro.example/cli/authorize?code=ABCD-EFGH",
          expiresIn: 600,
          interval: 2
        });
      }
      const encryptedToken = publicEncrypt({
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
      }, Buffer.from("sk-browser-secret")).toString("base64");
      return Response.json({ status: "approved", encryptedToken, algorithm: "RSA-OAEP-256" });
    };

    const code = await run(["connect"], {
      ...io(home, stdout),
      env: { ZRO_AUTH_URL: "https://zro.example", ZRO_DEVICE_NAME: "test laptop" },
      fetch: fetcher,
      openBrowser: async (url) => { openedUrl = url; return true; },
      sleep: async () => undefined
    });

    expect(code).toBe(0);
    expect(openedUrl).toBe("https://zro.example/cli/authorize?code=ABCD-EFGH");
    expect(JSON.parse(
      await fs.readFile(path.join(home, ".config", "zro", "credentials.json"), "utf8")
    ).apiKey).toBe("sk-browser-secret");
    const output = await streamText(stdout);
    expect(output).toContain("ABCD-EFGH");
    expect(output).toContain("Connected");
    expect(output).not.toContain("sk-browser-secret");
  });

  it("shows the command palette as help when no TTY is available", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-home-"));
    const stdout = new PassThrough();
    const code = await run([], io(home, stdout));

    expect(code).toBe(0);
    expect(await streamText(stdout)).toContain("zro claude");
  });

  it("launches directly and remembers the session", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-"));
    const stdout = new PassThrough();
    let sessionHome = "";
    const code = await run(["codex", "-m", "glm-5.2", "exec", "hello"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-new-secret" },
      spawn: fakeExitSpawn((command, args, options) => {
        expect(command).toBe("codex");
        expect(args).toEqual(["exec", "-c", 'model="glm-5.2"', "hello"]);
        expect(options.env.ZRO_API_KEY).toBe("sk-new-secret");
        sessionHome = String(options.env.CODEX_HOME);
      })
    });

    expect(code).toBe(0);
    const preferences = JSON.parse(
      await fs.readFile(path.join(home, ".config", "zro", "preferences.json"), "utf8")
    );
    expect(preferences).toMatchObject({ lastTool: "codex", lastModel: "glm-5.2" });
    await expect(fs.stat(sessionHome)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("produces a JSON preview without exposing or writing the key", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-preview-"));
    const stdout = new PassThrough();
    let spawned = false;
    const code = await run(["claude", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-preview-secret" },
      spawn: fakeExitSpawn(() => { spawned = true; })
    });

    expect(code).toBe(0);
    expect(spawned).toBe(false);
    const output = await streamText(stdout);
    expect(output).toContain('"tool": "claude"');
    expect(output).toContain("sk-****...cret");
    expect(output).not.toContain("sk-preview-secret");
    await expect(fs.stat(path.join(home, ".cache", "zro"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports connection and installed tools as JSON", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-status-"));
    const bin = path.join(home, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
    const stdout = new PassThrough();
    const code = await run(["status", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-status-secret", PATH: bin }
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    expect(result.connected).toBe(true);
    expect(result.credentialSource).toBe("environment");
    expect(result.tools.find((tool: { id: string }) => tool.id === "claude").installed).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sk-status-secret");
  });

  it("reports a fully disconnected state after removing the stored key", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-disconnect-"));
    const credentialDir = path.join(home, ".config", "zro");
    await fs.mkdir(credentialDir, { recursive: true });
    await fs.writeFile(path.join(credentialDir, "credentials.json"), JSON.stringify({ apiKey: "sk-stored" }));
    const stdout = new PassThrough();

    const code = await run(["disconnect", "--json"], io(home, stdout));

    expect(code).toBe(0);
    expect(JSON.parse(await streamText(stdout))).toEqual({
      connected: false,
      storedKeyRemoved: true,
      environmentKeySet: false
    });
  });
});

function io(home: string, stdout: PassThrough) {
  return {
    stdin: new PassThrough(),
    stdout,
    stderr: new PassThrough(),
    homeDir: home,
    cwd: home,
    env: {},
    platform: "linux" as const,
    version: "0.0.1"
  };
}

function fakeExitSpawn(assertion: (command: string, args: string[], options: SpawnOptions) => void): SpawnProcess {
  return ((command: string, args: string[], options: SpawnOptions) => {
    assertion(command, args, options);
    const child = new EventEmitter() as ChildProcess;
    queueMicrotask(() => child.emit("exit", 0, null));
    return child;
  }) as SpawnProcess;
}

async function streamText(stream: PassThrough): Promise<string> {
  stream.end();
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}
