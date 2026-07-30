import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  BASE_URL,
  MCP_URL,
  PROVIDER_ID,
  PROVIDER_NAME,
  ZRO_ENV_KEY,
  ZRO_MODELS,
} from "../src/engine/constants.js";
import { kiloTool } from "../src/engine/tools/kilo.js";
import type { LaunchContext } from "../src/engine/types.js";
import { run } from "../src/run.js";
import type { RunIo, SpawnProcess } from "../src/types.js";

describe("Kilo Code adapter", () => {
  it("builds an isolated, secret-safe profile with every Zro model and variant", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-kilo-home-"));
    const tempDir = path.join(home, "session");
    const userRoot = path.join(home, "user-config", "kilo");
    const sourceConfig = `{
      // Zro-owned and credential-bearing values must not be copied.
      model: "other/model",
      provider: { other: { options: { apiKey: "other-secret" } } },
      mcp: { other: { type: "remote", url: "https://example.invalid" } },
      autoupdate: true,
      remote_control: true,
      share: "auto",
      experimental: { openTelemetry: true },
      username: "Kilo preference",
      agent: {
        reviewer: {
          prompt: "Review carefully",
          model: "other/model",
          variant: "expensive",
          options: { apiKey: "nested-secret" },
          temperature: 0.2
        }
      },
      command: {
        review: {
          template: "Review this change",
          description: "Safe command",
          model: "other/model",
          variant: "expensive"
        }
      },
      instructions: ["rules/*.md", "https://example.invalid/rules.md"],
      plugin: [
        "safe-plugin",
        ["configured-plugin", { token: "plugin-secret" }],
        "https://user:password@example.invalid/plugin.js"
      ]
    }`;
    await fs.mkdir(path.join(userRoot, "agents"), { recursive: true });
    await fs.mkdir(path.join(userRoot, "node_modules", "ignored"), { recursive: true });
    await fs.writeFile(path.join(userRoot, "kilo.jsonc"), sourceConfig);
    await fs.writeFile(path.join(userRoot, "opencode.jsonc"), '{ username: "Ada" }\n');
    await fs.writeFile(path.join(userRoot, "agents", "helper.md"), "Helpful agent\n");
    await fs.writeFile(path.join(userRoot, "agents", ".env.local"), "TOKEN=do-not-copy\n");
    await fs.writeFile(path.join(userRoot, "auth.json"), '{"token":"do-not-copy"}\n');
    await fs.writeFile(path.join(userRoot, "node_modules", "ignored", "index.js"), "ignored\n");
    const outside = path.join(home, "outside-secret.md");
    await fs.writeFile(outside, "outside\n");
    if (process.platform !== "win32") {
      await fs.symlink(outside, path.join(userRoot, "agents", "linked.md"));
    }

    const ctx = context(home, tempDir, {
      XDG_CONFIG_HOME: path.join(home, "user-config"),
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.invalid",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=secret",
    });
    const plan = await kiloTool.launch(ctx);

    expect(plan).toMatchObject({
      tool: "kilo",
      label: "Kilo Code",
      command: "kilo",
      model: "glm-5.2",
      args: ["run", "hello"],
    });
    for (const key of [
      "HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_STATE_HOME",
      "KILO_CONFIG_DIR",
    ]) {
      expect(plan.env?.[key]?.startsWith(tempDir)).toBe(true);
    }
    expect(plan.env).toMatchObject({
      KILO_CONFIG: "",
      KILO_DB: "kilo.db",
      KILO_TELEMETRY_LEVEL: "off",
      KILO_DISABLE_AUTOUPDATE: "1",
      KILO_DISABLE_MODELS_FETCH: "1",
      KILO_DISABLE_SESSION_INGEST: "1",
      KILO_DISABLE_SHARE: "1",
      KILO_DISABLE_DEFAULT_PLUGINS: "1",
      KILO_AUTO_SHARE: "0",
      KILO_REMOTE: "0",
      KILO_AUTO_HEAP_SNAPSHOT: "0",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_HEADERS: "",
      DO_NOT_TRACK: "1",
      [ZRO_ENV_KEY]: "sk-kilo-secret",
    });
    expect(plan.env).not.toHaveProperty("KILO_DISABLE_PROJECT_CONFIG");
    expect(plan.env).not.toHaveProperty("KILO_PURE");
    expect(plan.env).not.toHaveProperty("KILO_PERMISSION");

    const overlay = JSON.parse(plan.env!.KILO_CONFIG_CONTENT) as Record<string, any>;
    expect(overlay).toMatchObject({
      $schema: "https://app.kilo.ai/config.json",
      model: `${PROVIDER_ID}/glm-5.2`,
      enabled_providers: [PROVIDER_ID],
      provider: {
        [PROVIDER_ID]: {
          npm: "@ai-sdk/openai-compatible",
          name: PROVIDER_NAME,
          options: {
            baseURL: BASE_URL,
            apiKey: `{env:${ZRO_ENV_KEY}}`,
          },
        },
      },
      mcp: {
        [PROVIDER_ID]: {
          type: "remote",
          url: MCP_URL,
          headers: { Authorization: `Bearer {env:${ZRO_ENV_KEY}}` },
          enabled: true,
          oauth: false,
        },
      },
      experimental: { openTelemetry: false },
      autoupdate: false,
      remote_control: false,
      share: "disabled",
    });
    expect(JSON.stringify(overlay)).not.toContain("sk-kilo-secret");

    const models = overlay.provider[PROVIDER_ID].models;
    expect(Object.keys(models).sort()).toEqual(ZRO_MODELS.map((model) => model.id).sort());
    for (const model of ZRO_MODELS) {
      expect(models[model.id]).toEqual({
        name: model.displayName,
        tool_call: true,
        reasoning: true,
        limit: {
          context: model.contextWindow,
          output: model.maxOutputTokens,
        },
        variants: Object.fromEntries(
          model.reasoning.levels.map((level) => [level.id, level.openCodeOptions]),
        ),
      });
    }

    const configFile = plan.files?.find((file) => path.basename(file.path) === "kilo.json");
    expect(configFile).toBeDefined();
    const safeConfig = JSON.parse(String(configFile!.contents)) as Record<string, any>;
    const serializedSafeConfig = JSON.stringify(safeConfig);
    expect(safeConfig).toMatchObject({
      $schema: "https://app.kilo.ai/config.json",
      username: "Ada",
      agent: {
        reviewer: { prompt: "Review carefully", temperature: 0.2 },
      },
      command: {
        review: { template: "Review this change", description: "Safe command" },
      },
      instructions: ["rules/*.md"],
      plugin: ["safe-plugin"],
    });
    expect(safeConfig).not.toHaveProperty("model");
    expect(safeConfig).not.toHaveProperty("provider");
    expect(safeConfig).not.toHaveProperty("mcp");
    expect(safeConfig).not.toHaveProperty("experimental");
    expect(safeConfig.agent.reviewer).not.toHaveProperty("model");
    expect(safeConfig.agent.reviewer).not.toHaveProperty("variant");
    expect(safeConfig.agent.reviewer).not.toHaveProperty("options");
    expect(safeConfig.command.review).not.toHaveProperty("model");
    expect(safeConfig.command.review).not.toHaveProperty("variant");
    for (const secret of ["other-secret", "nested-secret", "plugin-secret", "user:password"]) {
      expect(serializedSafeConfig).not.toContain(secret);
    }

    const plannedPaths = plan.files?.map((file) => file.path) ?? [];
    expect(plannedPaths.some((file) => file.endsWith(path.join("agents", "helper.md")))).toBe(true);
    expect(plannedPaths.some((file) => file.endsWith("linked.md"))).toBe(false);
    expect(plannedPaths.some((file) => file.endsWith(".env.local"))).toBe(false);
    expect(plannedPaths.some((file) => file.endsWith("auth.json"))).toBe(false);
    expect(plannedPaths.some((file) => file.includes("node_modules"))).toBe(false);
    expect(await fs.readFile(path.join(userRoot, "kilo.jsonc"), "utf8")).toBe(sourceConfig);

    const withoutCredential = {
      ...plan,
      env: { ...plan.env, [ZRO_ENV_KEY]: "[environment only]" },
    };
    expect(JSON.stringify(withoutCredential)).not.toContain("sk-kilo-secret");
  });

  it("rejects malformed user config without writing a session profile", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-kilo-invalid-"));
    const userRoot = path.join(home, ".config", "kilo");
    const tempDir = path.join(home, "session");
    await fs.mkdir(userRoot, { recursive: true });
    await fs.writeFile(path.join(userRoot, "kilo.jsonc"), "{ invalid:");

    await expect(kiloTool.launch(context(home, tempDir))).rejects.toThrow();
    await expect(fs.access(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps dry-run output secret-safe and writes no session files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-kilo-preview-"));
    const stdout = new PassThrough();
    const cache = path.join(home, "cache");
    const code = await run(["kilo", "--json"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {
        ZRO_API_KEY: "sk-preview-secret",
        XDG_CACHE_HOME: cache,
        XDG_CONFIG_HOME: path.join(home, "config"),
      },
      platform: "linux",
    });

    expect(code).toBe(0);
    const output = await streamText(stdout);
    expect(output).not.toContain("sk-preview-secret");
    const preview = JSON.parse(output) as Record<string, any>;
    expect(preview).toMatchObject({ tool: "kilo", command: "kilo", model: "minimax-m3" });
    expect(JSON.parse(preview.environment.KILO_CONFIG_CONTENT)).toMatchObject({
      model: "zro/minimax-m3",
    });
    await expect(fs.access(path.join(cache, "zro", "sessions"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["success", 0, 0],
    ["nonzero exit", 7, 7],
    ["spawn failure", "error", 1],
  ] as const)("cleans its temporary profile after %s", async (_name, childResult, expectedCode) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-kilo-cleanup-"));
    const cache = path.join(home, "cache");
    const stderr = new PassThrough();
    const spawn: SpawnProcess = () => {
      const child = new EventEmitter() as ChildProcess;
      process.nextTick(() => {
        if (childResult === "error") child.emit("error", new Error("spawn failed"));
        else child.emit("exit", childResult, null);
      });
      return child;
    };
    const io: RunIo = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      homeDir: home,
      cwd: home,
      env: {
        ZRO_API_KEY: "sk-cleanup-secret",
        XDG_CACHE_HOME: cache,
        XDG_CONFIG_HOME: path.join(home, "config"),
      },
      platform: "linux",
      spawn,
      fetch: async () => new Response(null, { status: 200 }),
    };

    expect(await run(["kilo"], io)).toBe(expectedCode);
    const sessions = path.join(cache, "zro", "sessions");
    expect(await readOptionalDirectory(sessions)).toEqual([]);
    if (childResult === "error") expect(await streamText(stderr)).toContain("spawn failed");
  });
});

function context(
  homeDir: string,
  tempDir: string,
  env: NodeJS.ProcessEnv = {},
): LaunchContext {
  return {
    apiKey: "sk-kilo-secret",
    apiKeySource: "env",
    env,
    model: "glm-5.2",
    extraArgs: ["run", "hello"],
    homeDir,
    cwd: homeDir,
    tempDir,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}

async function streamText(stream: PassThrough): Promise<string> {
  stream.end();
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}

async function readOptionalDirectory(directory: string): Promise<string[]> {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
