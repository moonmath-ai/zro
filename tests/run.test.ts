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
      if (url.endsWith("/api/cli/auth/start")) {
        const body = JSON.parse(String(init?.body)) as { publicKey: string };
        publicKey = body.publicKey;
        return Response.json({
          deviceCode: "device-secret",
          userCode: "ABCD-EFGH",
          verificationUri: "http://container:3000/cli/authorize",
          verificationUriComplete: "http://container:3000/cli/authorize?code=ABCD-EFGH",
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

    const code = await run(["login"], {
      ...io(home, stdout),
      env: {
        ZRO_AUTH_URL: "https://auth.zro.example",
        ZRO_PUBLIC_URL: "https://zro.example",
        ZRO_DEVICE_NAME: "test laptop",
      },
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
    expect(output).toContain("Logged in");
    expect(output).not.toContain("sk-browser-secret");
  });

  it("offers website and API key login choices in an interactive terminal", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-login-choice-"));
    const stdin = new PassThrough() as PassThrough & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode(mode: boolean): void;
    };
    const stdout = new PassThrough() as PassThrough & { isTTY: boolean };
    const stderr = new PassThrough();
    stdin.isTTY = true;
    stdin.isRaw = false;
    stdin.setRawMode = (mode) => { stdin.isRaw = mode; };
    stdout.isTTY = true;

    const result = run(["login"], {
      ...io(home, stdout),
      stdin,
      stderr,
    });
    queueMicrotask(() => {
      stdin.write("\u001b[B\r");
      setImmediate(() => stdin.end("sk-chosen-manually\n"));
    });

    expect(await result).toBe(0);
    expect(JSON.parse(
      await fs.readFile(path.join(home, ".config", "zro", "credentials.json"), "utf8"),
    ).apiKey).toBe("sk-chosen-manually");
    const output = await streamText(stdout);
    expect(output).toContain("How do you want to log in?");
    expect(output).toContain("Login with website");
    expect(output).toContain("Login with API key");
    expect(output).not.toContain("sk-chosen-manually");
    expect(await streamText(stderr)).toBe("");
  });

  it("prompts for an API key when website login is unavailable", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-login-fallback-"));
    const stdin = new PassThrough() as PassThrough & { isTTY: boolean };
    const stdout = new PassThrough() as PassThrough & { isTTY: boolean };
    const stderr = new PassThrough();
    stdin.isTTY = true;
    stdout.isTTY = true;

    const result = run(["login", "--no-browser"], {
      ...io(home, stdout),
      stdin,
      stderr,
      fetch: async () => Response.json(
        { error: "not found" },
        { status: 404 },
      ),
    });
    queueMicrotask(() => stdin.end("sk-manual-fallback\n"));

    expect(await result).toBe(0);
    expect(JSON.parse(
      await fs.readFile(path.join(home, ".config", "zro", "credentials.json"), "utf8")
    ).apiKey).toBe("sk-manual-fallback");
    const output = await streamText(stdout);
    expect(output).toContain("Website sign-in is unavailable.");
    expect(output).toContain("Paste your Zro API key to continue.");
    expect(output).toContain("Logged in");
    expect(output).not.toContain("sk-manual-fallback");
    expect(await streamText(stderr)).toBe("");
  });

  it("shows the command palette as help when no TTY is available", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-home-"));
    const stdout = new PassThrough();
    const code = await run([], io(home, stdout));

    expect(code).toBe(0);
    expect(await streamText(stdout)).toContain("zro claude");
  });

  it("lists the authenticated control-plane model catalog", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-models-"));
    const stdout = new PassThrough();
    const catalog = dynamicCatalogResponse();

    const code = await run(["models", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-models-secret" },
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://zro.moonmath.ai/api/cli/models");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-models-secret");
        return Response.json(catalog);
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(await streamText(stdout))).toEqual(catalog);
  });

  it("accepts a remotely added model without a CLI release", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-dynamic-model-"));
    const stdout = new PassThrough();

    const code = await run(["codex", "-m", "future-model", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-dynamic-secret" },
      fetch: async () => Response.json(dynamicCatalogResponse()),
    });

    expect(code).toBe(0);
    expect(JSON.parse(await streamText(stdout))).toMatchObject({
      tool: "codex",
      model: "future-model",
    });
    await expect(fs.stat(path.join(home, ".cache", "zro")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("launches directly and remembers the session", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-launch-"));
    const stdout = new PassThrough();
    let sessionHome = "";
    const code = await run(["codex", "-m", "deepseek-v4.1-flash", "exec", "hello"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-new-secret" },
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://zro.moonmath.ai/v1/models");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-new-secret");
        return Response.json({ data: [] });
      },
      spawn: fakeExitSpawn((command, args, options) => {
        expect(command).toBe("codex");
        expect(args).toEqual(["exec", "-c", 'model="deepseek-v4.1-flash"', "hello"]);
        expect(options.env.ZRO_API_KEY).toBe("sk-new-secret");
        sessionHome = String(options.env.CODEX_HOME);
      })
    });

    expect(code).toBe(0);
    const preferences = JSON.parse(
      await fs.readFile(path.join(home, ".config", "zro", "preferences.json"), "utf8")
    );
    expect(preferences).toMatchObject({ lastTool: "codex", lastModel: "deepseek-v4.1-flash" });
    await expect(fs.stat(sessionHome)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not launch an agent when the API rejects the key", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-rejected-key-"));
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let spawned = false;

    const code = await run(["codex"], {
      ...io(home, stdout),
      stderr,
      env: { ZRO_API_KEY: "sk-rejected-secret" },
      fetch: async () => Response.json(
        { error: { message: "invalid key" } },
        { status: 401 },
      ),
      spawn: fakeExitSpawn(() => { spawned = true; }),
    });

    expect(code).toBe(1);
    expect(spawned).toBe(false);
    expect(await streamText(stderr)).toContain(
      "Authentication failed: Zro rejected the API key (HTTP 401).",
    );
    await expect(fs.stat(path.join(home, ".config", "zro", "preferences.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not launch an agent when authentication cannot be verified", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-auth-unavailable-"));
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let spawned = false;

    const code = await run(["claude"], {
      ...io(home, stdout),
      stderr,
      env: { ZRO_API_KEY: "sk-unverified-secret" },
      fetch: async () => new Response(null, { status: 503 }),
      spawn: fakeExitSpawn(() => { spawned = true; }),
    });

    expect(code).toBe(1);
    expect(spawned).toBe(false);
    expect(await streamText(stderr)).toContain(
      "Could not verify Zro authentication: HTTP 503",
    );
  });

  it("produces a JSON preview without exposing or writing the key", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-preview-"));
    const stdout = new PassThrough();
    let spawned = false;
    const code = await run(["claude", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-preview-secret" },
      fetch: async () => new Response(null, { status: 503 }),
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
      env: {
        ZRO_API_KEY: "sk-status-secret",
        ZRO_AUTH_URL: "https://auth.zro.example",
        PATH: bin,
      },
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://auth.zro.example/api/cli/status");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-status-secret");
        return Response.json(accountStatusResponse());
      },
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    expect(result.connected).toBe(true);
    expect(result.credentialSource).toBe("environment");
    expect(result.accountStatus).toBe("available");
    expect(result.account.billing.usagePacks.remaining).toBe(15);
    expect(result.account.activity30d.totalTokens).toBe(1250);
    expect(result.tools.find((tool: { id: string }) => tool.id === "claude").installed).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sk-status-secret");
  });

  it("shows account usage and balances in human status", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-account-status-"));
    const stdout = new PassThrough();
    const code = await run(["status"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-status-secret" },
      fetch: async () => Response.json(accountStatusResponse()),
    });

    expect(code).toBe(0);
    const output = await streamText(stdout);
    expect(output).toContain("Plan         Pro · active");
    expect(output).toContain("Plan usage   $8.00 of $60.00 · $52.00 left");
    expect(output).toContain("Usage packs  $15.00 left · $20.00 total");
    expect(output).toContain("Available    $67.00 total");
    expect(output).toContain("Last 30 days 15 requests · 1,250 tokens");
  });

  it("reports a rejected stored key as disconnected", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-rejected-status-"));
    const credentialDir = path.join(home, ".config", "zro");
    await fs.mkdir(credentialDir, { recursive: true });
    await fs.writeFile(
      path.join(credentialDir, "credentials.json"),
      JSON.stringify({ apiKey: "sk-rejected" }),
    );
    const stdout = new PassThrough();

    const code = await run(["status", "--json"], {
      ...io(home, stdout),
      fetch: async () => Response.json({ error: "invalid" }, { status: 401 }),
    });

    expect(code).toBe(0);
    expect(JSON.parse(await streamText(stdout))).toMatchObject({
      connected: false,
      credentialSource: "stored",
      accountStatus: "rejected",
      account: null,
    });
  });

  it("reports a fully disconnected state after removing the stored key", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-disconnect-"));
    const credentialDir = path.join(home, ".config", "zro");
    const codexAppDir = path.join(credentialDir, "codex-app");
    await fs.mkdir(credentialDir, { recursive: true });
    await fs.writeFile(path.join(credentialDir, "credentials.json"), JSON.stringify({ apiKey: "sk-stored" }));
    await fs.mkdir(codexAppDir);
    await fs.writeFile(path.join(codexAppDir, ".env"), "ZRO_API_KEY=sk-stored\n");
    await fs.writeFile(path.join(codexAppDir, "config.toml"), "model = \"deepseek-v4.1-flash\"\n");
    const catalogPath = path.join(home, ".cache", "zro", "model-catalog.json");
    await fs.mkdir(path.dirname(catalogPath), { recursive: true });
    await fs.writeFile(catalogPath, JSON.stringify(dynamicCatalogResponse()));
    const stdout = new PassThrough();

    const code = await run(["logout", "--json"], io(home, stdout));

    expect(code).toBe(0);
    expect(JSON.parse(await streamText(stdout))).toEqual({
      connected: false,
      storedKeyRemoved: true,
      environmentKeySet: false
    });
    await expect(fs.stat(path.join(credentialDir, "credentials.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(codexAppDir, ".env")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(catalogPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(codexAppDir, "config.toml"), "utf8"))
      .resolves.toBe("model = \"deepseek-v4.1-flash\"\n");
  });

  it("removes the Codex App key when it is the only stored credential", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-codex-app-logout-"));
    const codexAppDir = path.join(home, ".config", "zro", "codex-app");
    await fs.mkdir(codexAppDir, { recursive: true });
    await fs.writeFile(path.join(codexAppDir, ".env"), "ZRO_API_KEY=sk-codex-app\n");
    const stdout = new PassThrough();

    const code = await run(["logout", "--json"], io(home, stdout));

    expect(code).toBe(0);
    expect(JSON.parse(await streamText(stdout))).toMatchObject({
      connected: false,
      storedKeyRemoved: true,
    });
    await expect(fs.stat(path.join(codexAppDir, ".env")))
      .rejects.toMatchObject({ code: "ENOENT" });
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

function accountStatusResponse() {
  return {
    key: { id: "key_1", alias: "Laptop" },
    billing: {
      status: "active",
      currency: "USD",
      plan: {
        id: "pro",
        name: "Pro",
        allowance: 60,
        used: 8,
        remaining: 52,
      },
      usagePacks: { total: 20, used: 5, remaining: 15 },
      totalRemaining: 67,
    },
    activity30d: {
      requests: 15,
      modelRequests: 12,
      toolCalls: 3,
      inputTokens: 1000,
      outputTokens: 250,
      totalTokens: 1250,
      cacheReadInputTokens: 400,
      spend: 8,
    },
  };
}

function dynamicCatalogResponse() {
  return {
    version: 1,
    default: "future-model",
    models: [
      {
        id: "future-model",
        displayName: "Future Model",
        contextWindow: 200_000,
        maxOutputTokens: 20_000,
        reasoning: {
          defaultLevel: "high",
          levels: [
            {
              id: "high",
              description: "Reason carefully",
              piLevel: "high",
              openCodeOptions: { reasoningEffort: "high" },
            },
          ],
        },
      },
    ],
  };
}
