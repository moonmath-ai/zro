import type { ChildProcess } from "node:child_process";
import { constants, publicEncrypt } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODEL_ALIAS_SLOTS, claudeTool } from "../src/engine/tools/claude.js";
import { ZRO_MODELS } from "../src/engine/constants.js";
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
    expect(JSON.parse(await streamText(stdout))).toEqual({ ...catalog, source: "remote" });
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
    const code = await run(["codex", "-m", "glm-5.3", "exec", "hello"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-new-secret" },
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://zro.moonmath.ai/v1/models");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-new-secret");
        return Response.json({ data: [] });
      },
      spawn: fakeExitSpawn((command, args, options) => {
        expect(command).toBe("codex");
        expect(args).toEqual(["exec", "-c", 'model="glm-5.3"', "hello"]);
        expect(options.env.ZRO_API_KEY).toBe("sk-new-secret");
        sessionHome = String(options.env.CODEX_HOME);
      })
    });

    expect(code).toBe(0);
    const preferences = JSON.parse(
      await fs.readFile(path.join(home, ".config", "zro", "preferences.json"), "utf8")
    );
    expect(preferences).toMatchObject({ lastTool: "codex", lastModel: "glm-5.3" });
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

  it("sets CLAUDE_CODE_MAX_CONTEXT_TOKENS and appends [1m] for 1M-window models", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-context-"));
    const stdout = new PassThrough();

    const code = await run(["claude", "-m", "kimi-k3", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    const modelArg = result.args[result.args.indexOf("--model") + 1];
    expect(result.model).toBe("kimi-k3");
    expect(result.environment.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("1048576");
    expect(modelArg).toBe("kimi-k3[1m]");
    expect(result.environment.ANTHROPIC_CUSTOM_MODEL_OPTION).toBe("kimi-k3[1m]");
    // Deterministic tier mapping: unclaimed models sort by max output tokens
    // descending with id tie-breaks, so opus gets the beefiest model and haiku
    // the smallest; glm-5.3-flash (fifth remaining) lands in no slot.
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("deepseek-v4.1-flash[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("auto[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("glm-5.3[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("dolly1-security[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBe("Zro DeepSeek V4.1 Flash[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME).toBe("Zro Dolly 1 Security[1m]");
    expect(result.environment.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME).toBe("Zro Kimi K3[1m]");
  });

  it("allowlists the seated tier aliases and the bare form of every emitted model id", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-allowlist-"));
    const stdout = new PassThrough();

    const code = await run(["claude", "-m", "kimi-k3", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    const managed = JSON.parse(result.args[result.args.indexOf("--managed-settings") + 1]);
    const env = result.environment as Record<string, string>;
    expect(managed.enforceAvailableModels).toBe(true);
    // Derived from the resolved catalog, not hard-coded: every bundled model is
    // allowlisted, and with six models every tier slot is seated.
    expect(managed.availableModels).toEqual([
      ...ZRO_MODELS.map((model) => model.id),
      ...CLAUDE_MODEL_ALIAS_SLOTS.map((slot) => slot.toLowerCase())
    ]);
    // The picker gate strips [1m] before matching, so the bare id of every
    // emitted value must be allowlisted (the values themselves are suffixed).
    const bare = (value: string) => value.replace(/\[1m\]$/i, "");
    for (const key of [
      "ANTHROPIC_CUSTOM_MODEL_OPTION",
      ...CLAUDE_MODEL_ALIAS_SLOTS.map((slot) => `ANTHROPIC_DEFAULT_${slot}_MODEL`)
    ]) {
      const value = env[key];
      if (value) expect(managed.availableModels).toContain(bare(value));
    }
    // The reverse must hold too: every allowlisted tier alias is actually
    // seated with an env value (no allowlisted-but-unemitted slot).
    for (const slot of CLAUDE_MODEL_ALIAS_SLOTS) {
      const allowlisted = managed.availableModels.includes(slot.toLowerCase());
      const seated = Boolean(env[`ANTHROPIC_DEFAULT_${slot}_MODEL`]);
      expect(allowlisted, slot).toBe(seated);
    }
  });

  it("does not allowlist a slot whose model is outside the launch catalog", async () => {
    const stderr = new PassThrough();
    const plan = await claudeTool.launch({
      apiKey: "sk-boundary-secret",
      apiKeySource: "env",
      env: {},
      model: "kimi-k3",
      models: ZRO_MODELS.filter((model) => model.id !== "glm-5.3"),
      modelAliases: { OPUS: "glm-5.3" },
      extraArgs: [],
      homeDir: "/tmp",
      cwd: "/tmp",
      tempDir: "/tmp/zro-boundary-test",
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr
    });
    const managed = JSON.parse(plan.args![plan.args!.indexOf("--managed-settings") + 1]);
    expect(managed.availableModels).not.toContain("opus");
    expect(plan.env!.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    // The unrepresentable alias must not consume a slot either: the remaining
    // slots fill from the catalog as if it were dropped.
    expect(plan.env!.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeDefined();
  });

  it("lets users override Claude alias slots with --alias, including dropping one", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-alias-"));
    const stdout = new PassThrough();

    const code = await run([
      "claude", "-m", "kimi-k3", "--alias", "opus=glm-5.3", "--alias", "haiku=", "--json"
    ], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.3[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek-v4.1-flash[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("auto[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    // A dropped slot must not be allowlisted, or Claude Code re-enables its row
    // resolving to the built-in Anthropic model against the Zro base URL.
    const managed = JSON.parse(result.args[result.args.indexOf("--managed-settings") + 1]);
    expect(managed.availableModels).not.toContain("haiku");
    expect(managed.availableModels).toEqual(expect.arrayContaining(["opus", "sonnet", "fable"]));
  });

  it("forwards --alias overrides through zro again", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-again-alias-"));
    const stdout = new PassThrough();

    const launchCode = await run(["claude", "-m", "kimi-k3"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-again-secret" },
      fetch: async () => Response.json({ data: [] }),
      spawn: fakeExitSpawn(() => {})
    });
    expect(launchCode).toBe(0);

    const againStdout = new PassThrough();
    const againCode = await run(["again", "--alias", "opus=glm-5.3", "--dry-run", "--json"], {
      ...io(home, againStdout),
      env: { ZRO_API_KEY: "sk-again-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });
    expect(againCode).toBe(0);
    const result = JSON.parse(await streamText(againStdout));
    expect(result.tool).toBe("claude");
    expect(result.model).toBe("kimi-k3");
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.3[1m]");
  });

  it("warns instead of staying silent when the selected model is in no catalog", async () => {
    const stderr = new PassThrough();
    const plan = await claudeTool.launch({
      apiKey: "sk-warn-secret",
      apiKeySource: "env",
      env: {},
      model: "uncatalogued-model",
      models: [],
      extraArgs: [],
      homeDir: "/tmp",
      cwd: "/tmp",
      tempDir: "/tmp/zro-warn-test",
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr
    });
    expect(plan.env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(await streamText(stderr)).toContain(
      'Warning: model "uncatalogued-model" is not in the Zro catalog'
    );
  });

  it("keeps self-targeting aliases explicit even though they cost a slot", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-alias-seated-"));
    const stdout = new PassThrough();
    const cacheDir = path.join(home, ".cache", "zro");
    await fs.mkdir(cacheDir, { recursive: true });
    const catalogModel = (id: string, contextWindow: number, maxOutputTokens: number) => ({
      id,
      displayName: id,
      contextWindow,
      maxOutputTokens,
      reasoning: {
        defaultLevel: "high",
        levels: [{ id: "high", description: "Reason carefully", piLevel: "high", openCodeOptions: { reasoningEffort: "high" } }]
      }
    });
    await fs.writeFile(path.join(cacheDir, "model-catalog.json"), JSON.stringify({
      version: 1,
      default: "m-a",
      models: [
        catalogModel("m-a", 1048576, 131000),
        catalogModel("m-b", 1048576, 384000),
        catalogModel("m-c", 1048576, 131000),
        catalogModel("m-d", 1048576, 64000),
        catalogModel("m-e", 524288, 64000)
      ]
    }));

    const code = await run(["claude", "-m", "m-a", "--alias", "opus=m-a", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("m-a[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("m-b[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("m-c[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("m-d[1m]");
    expect(result.environment.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("1048576");
  });

  it("lets an explicit alias target the selected model, reserving the rest by tier", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-alias-self-"));
    const stdout = new PassThrough();

    const code = await run(["claude", "-m", "glm-5.3", "--alias", "opus=glm-5.3", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    expect(result.model).toBe("glm-5.3");
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.3[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("kimi-k3[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("deepseek-v4.1-flash[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("auto[1m]");
  });

  it("budgets the smallest context window across the selection and filled alias slots", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-mixed-window-"));
    const stdout = new PassThrough();
    const cacheDir = path.join(home, ".cache", "zro");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "model-catalog.json"), JSON.stringify({
      version: 1,
      default: "legacy-1m",
      models: [
        {
          id: "legacy-512k",
          displayName: "Legacy 512k",
          contextWindow: 524288,
          maxOutputTokens: 64000,
          reasoning: {
            defaultLevel: "high",
            levels: [{ id: "high", description: "Reason carefully", piLevel: "high", openCodeOptions: { reasoningEffort: "high" } }]
          }
        },
        {
          id: "legacy-1m",
          displayName: "Legacy 1M",
          contextWindow: 1048576,
          maxOutputTokens: 64000,
          reasoning: {
            defaultLevel: "high",
            levels: [{ id: "high", description: "Reason carefully", piLevel: "high", openCodeOptions: { reasoningEffort: "high" } }]
          }
        },
        {
          id: "legacy-1m-plus",
          displayName: "Legacy 1M Plus",
          contextWindow: 1048576,
          maxOutputTokens: 384000,
          reasoning: {
            defaultLevel: "high",
            levels: [{ id: "high", description: "Reason carefully", piLevel: "high", openCodeOptions: { reasoningEffort: "high" } }]
          }
        }
      ]
    }));

    // Dropping HAIKU makes legacy-512k reachable only through its filled slot
    // (SONNET), so the budget must account for slot models, not just the
    // selection's own window.
    const code = await run(["claude", "-m", "legacy-1m", "--alias", "haiku=", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("legacy-1m-plus[1m]");
    expect(result.environment.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("legacy-512k");
    expect(result.environment.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    // Sub-1M slot names carry no [1m] marker.
    expect(result.environment.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBe("Zro Legacy 512k");
    // The catalog fills only two slots; the unfilled ones must stay off the
    // allowlist so Claude Code cannot surface built-in Anthropic rows for them.
    const managed = JSON.parse(result.args[result.args.indexOf("--managed-settings") + 1]);
    expect(managed.availableModels).toEqual(expect.arrayContaining(["opus", "sonnet"]));
    expect(managed.availableModels).not.toContain("fable");
    expect(managed.availableModels).not.toContain("haiku");
    expect(result.environment.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("524288");
  });

  it("tailors unknown-model refusals to the catalog source", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-unknown-model-"));
    const stdout = new PassThrough();

    const remoteStderr = new PassThrough();
    const remoteCode = await run(["claude", "-m", "missing", "--json"], {
      ...io(home, stdout),
      stderr: remoteStderr,
      env: { ZRO_API_KEY: "sk-source-secret" },
      fetch: async () => Response.json(dynamicCatalogResponse()),
    });
    expect(remoteCode).toBe(1);
    expect(await streamText(remoteStderr)).toContain(
      'Unknown model "missing". It is not offered by your account\'s catalog.'
    );

    const cacheDir = path.join(home, ".cache", "zro");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "model-catalog.json"), JSON.stringify({
      version: 1,
      default: "cached-model",
      models: [{
        id: "cached-model",
        displayName: "Cached Model",
        contextWindow: 1048576,
        maxOutputTokens: 64000,
        reasoning: {
          defaultLevel: "high",
          levels: [{ id: "high", description: "Reason carefully", piLevel: "high", openCodeOptions: { reasoningEffort: "high" } }]
        }
      }]
    }));

    const cacheStderr = new PassThrough();
    const cacheCode = await run(["claude", "-m", "missing", "--json"], {
      ...io(home, stdout),
      stderr: cacheStderr,
      env: { ZRO_API_KEY: "sk-source-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });
    expect(cacheCode).toBe(1);
    expect(await streamText(cacheStderr)).toContain(
      'Unknown model "missing". It is not in the cached catalog from your last login. Run zro login'
    );

    const bundledStderr = new PassThrough();
    const bundledHome = await fs.mkdtemp(path.join(os.tmpdir(), "zro-unknown-model-2-"));
    const bundledCode = await run(["claude", "-m", "missing", "--json"], {
      ...io(bundledHome, stdout),
      stderr: bundledStderr,
      env: { ZRO_API_KEY: "sk-source-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });
    expect(bundledCode).toBe(1);
    expect(await streamText(bundledStderr)).toContain(
      'Unknown model "missing". It is not in the offline catalog bundled with zro.'
    );
  });

  it("rejects alias overrides with unknown slots, unknown models, or other tools", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-alias-bad-"));
    const stdout = new PassThrough();

    const slotStderr = new PassThrough();
    const slotCode = await run(["claude", "--alias", "turbo=glm-5.3", "--json"], {
      ...io(home, stdout),
      stderr: slotStderr,
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });
    expect(slotCode).toBe(1);
    expect(await streamText(slotStderr)).toContain("Unknown alias slot");

    const modelStderr = new PassThrough();
    const modelCode = await run(["claude", "--alias", "opus=nope", "--json"], {
      ...io(home, stdout),
      stderr: modelStderr,
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });
    expect(modelCode).toBe(1);
    expect(await streamText(modelStderr)).toContain('Unknown model "nope" for alias opus');

    const toolStderr = new PassThrough();
    const toolCode = await run(["codex", "--alias", "opus=glm-5.3", "--json"], {
      ...io(home, stdout),
      stderr: toolStderr,
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });
    expect(toolCode).toBe(1);
    expect(await streamText(toolStderr)).toContain("--alias is only supported for the claude tool");
  });

  it("does not append [1m] for sub-1M-window models from the cached catalog", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-claude-no1m-"));
    const stdout = new PassThrough();
    const cacheDir = path.join(home, ".cache", "zro");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "model-catalog.json"), JSON.stringify({
      version: 1,
      default: "glm-5.2",
      models: [{
        id: "glm-5.2",
        displayName: "GLM-5.2",
        contextWindow: 524288,
        maxOutputTokens: 64000,
        reasoning: {
          defaultLevel: "max",
          levels: [{
            id: "max",
            description: "Use GLM maximum reasoning effort",
            piLevel: "xhigh",
            openCodeOptions: { reasoningEffort: "max" }
          }]
        }
      }]
    }));

    const code = await run(["claude", "-m", "glm-5.2", "--json"], {
      ...io(home, stdout),
      env: { ZRO_API_KEY: "sk-context-secret" },
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(code).toBe(0);
    const result = JSON.parse(await streamText(stdout));
    const modelArg = result.args[result.args.indexOf("--model") + 1];
    expect(result.model).toBe("glm-5.2");
    expect(result.environment.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("524288");
    expect(modelArg).toBe("glm-5.2");
    expect(result.environment.ANTHROPIC_CUSTOM_MODEL_OPTION).toBe("glm-5.2");
    expect(result.environment.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME).toBe("Zro GLM-5.2");
    expect(result.environment.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    const managed = JSON.parse(result.args[result.args.indexOf("--managed-settings") + 1]);
    expect(managed.availableModels).toEqual(["glm-5.2"]);
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
    await fs.writeFile(path.join(codexAppDir, "config.toml"), "model = \"glm-5.3\"\n");
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
      .resolves.toBe("model = \"glm-5.3\"\n");
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

  it("sends feedback with the stored key and confirms in JSON", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-feedback-"));
    const credentialDir = path.join(home, ".config", "zro");
    await fs.mkdir(credentialDir, { recursive: true });
    await fs.writeFile(
      path.join(credentialDir, "credentials.json"),
      JSON.stringify({ apiKey: "sk-feedback" }),
    );
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let body: Record<string, unknown> | undefined;

    const code = await run(["feedback", "I love it", "--json"], {
      ...io(home, stdout),
      stderr,
      env: { ZRO_DEVICE_NAME: "work-laptop" },
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://zro.moonmath.ai/api/cli/feedback");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-feedback");
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ ok: true });
      },
    });

    expect(code).toBe(0);
    expect(body).toMatchObject({
      message: "I love it",
      version: "0.0.1",
      deviceName: "work-laptop",
      deviceType: "desktop",
      os: "linux",
    });
    expect(typeof body?.timestamp).toBe("string");
    expect(typeof body?.arch).toBe("string");
    expect(typeof body?.nodeVersion).toBe("string");
    expect(JSON.parse(await streamText(stdout))).toEqual({ sent: true });
    expect(JSON.stringify(body)).not.toContain("sk-feedback");
    expect(await streamText(stderr)).toBe("");
  });

  it("requires a credential before sending feedback", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-feedback-auth-"));
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let fetched = false;

    const code = await run(["feedback", "nice tool"], {
      ...io(home, stdout),
      stderr,
      fetch: async () => { fetched = true; return Response.json({ ok: true }); },
    });

    expect(code).toBe(1);
    expect(fetched).toBe(false);
    expect(await streamText(stderr)).toContain("Log in to send feedback");
  });

  it("reports a failure to send feedback without exiting silently", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-feedback-fail-"));
    const credentialDir = path.join(home, ".config", "zro");
    await fs.mkdir(credentialDir, { recursive: true });
    await fs.writeFile(
      path.join(credentialDir, "credentials.json"),
      JSON.stringify({ apiKey: "sk-feedback-fail" }),
    );
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    const code = await run(["feedback", "hello"], {
      ...io(home, stdout),
      stderr,
      fetch: async () => new Response(null, { status: 500 }),
    });

    expect(code).toBe(1);
    expect(await streamText(stderr)).toContain("Could not send feedback (HTTP 500)");
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
        modalities: {
          input: ["text"] as const,
          output: ["text"] as const,
        },
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
