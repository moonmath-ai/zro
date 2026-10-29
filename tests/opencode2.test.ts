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
} from "../src/engine/constants.js";
import { buildOpenCode2Config, opencode2Tool } from "../src/engine/tools/opencode2.js";
import type { LaunchContext } from "../src/engine/types.js";
import { TEST_MODELS } from "./fixtures.js";

describe("OpenCode 2 config", () => {
  it("builds the native v2 provider, model, and MCP shape", () => {
    const config = buildOpenCode2Config({}, "sk-zro", TEST_MODELS, true);
    const providers = config.providers as Record<string, any>;
    const provider = providers[PROVIDER_ID];

    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(provider).toMatchObject({
      name: PROVIDER_NAME,
      package: "@opencode/ai/providers/openai-compatible",
      settings: {
        baseURL: BASE_URL,
        apiKey: `{env:${ZRO_ENV_KEY}}`,
      },
    });
    expect(provider).not.toHaveProperty("headers");

    const glm = provider.models["glm-5.3"];
    expect(glm.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] });
    expect(glm.limit).toEqual({
      context: TEST_MODELS[0].contextWindow,
      output: TEST_MODELS[0].maxOutputTokens,
    });
    expect(glm.variants).toEqual(
      TEST_MODELS[0].reasoning.levels.map((level) => ({
        id: level.id,
        settings: level.openCodeOptions,
      })),
    );

    const kimi = provider.models["kimi-k3"];
    expect(kimi.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] });

    expect(config.mcp).toEqual({
      servers: {
        [PROVIDER_ID]: {
          type: "remote",
          url: MCP_URL,
          oauth: false,
          headers: { Authorization: `Bearer {env:${ZRO_ENV_KEY}}` },
        },
      },
    });
  });

  it("writes the literal key when env references are disabled", () => {
    const config = buildOpenCode2Config({}, "sk-zro", TEST_MODELS, false);
    const provider = (config.providers as Record<string, any>)[PROVIDER_ID];
    expect(provider.settings.apiKey).toBe("sk-zro");
  });

  it("preserves other providers and MCP servers", () => {
    const existing = {
      providers: { other: { name: "Other", settings: { baseURL: "https://other.invalid" } } },
      mcp: { servers: { other: { type: "local", command: ["other"] } } },
    };
    const config = buildOpenCode2Config(existing, "sk-zro", TEST_MODELS, true);
    expect((config.providers as Record<string, any>).other).toEqual(existing.providers.other);
    expect((config.mcp as Record<string, any>).servers.other).toEqual(existing.mcp.servers.other);
  });

  it("drops legacy v1 zro entries so only the native v2 config remains", () => {
    const existing = {
      provider: {
        [PROVIDER_ID]: { npm: "@ai-sdk/openai-compatible", options: { apiKey: "old" } },
        other: { npm: "@ai-sdk/openai-compatible" },
      },
      mcp: {
        [PROVIDER_ID]: { type: "remote", url: "https://old.invalid" },
        servers: { other: { type: "local", command: ["other"] } },
      },
    };
    const config = buildOpenCode2Config(existing, "sk-zro", TEST_MODELS, true);

    const provider = config.provider as Record<string, unknown>;
    expect(provider[PROVIDER_ID]).toBeUndefined();
    expect(provider.other).toEqual(existing.provider.other);

    const mcp = config.mcp as Record<string, any>;
    expect(mcp[PROVIDER_ID]).toBeUndefined();
    expect(mcp.servers.other).toEqual(existing.mcp.servers.other);
    expect(mcp.servers[PROVIDER_ID]).toBeDefined();
  });

  it("removes an empty legacy provider map", () => {
    const config = buildOpenCode2Config(
      { provider: { [PROVIDER_ID]: { npm: "@ai-sdk/openai-compatible" } } },
      "sk-zro",
      TEST_MODELS,
      true,
    );
    expect(config).not.toHaveProperty("provider");
  });

  it("merges v2 variant arrays by id and ignores v1 object variants", () => {
    const existing = {
      providers: {
        [PROVIDER_ID]: {
          models: {
            "glm-5.3": {
              variants: [
                { id: "high", settings: { textVerbosity: "low" }, keep: true },
                { id: "custom", settings: { foo: "bar" } },
              ],
            },
          },
        },
      },
    };
    const config = buildOpenCode2Config(existing, "sk-zro", TEST_MODELS, true);
    const variants = (config.providers as Record<string, any>)[PROVIDER_ID].models["glm-5.3"].variants;
    expect(Array.isArray(variants)).toBe(true);
    expect(variants).toContainEqual({
      id: "high",
      settings: { reasoningEffort: "high", textVerbosity: "low" },
      keep: true,
    });
    expect(variants).toContainEqual({ id: "custom", settings: { foo: "bar" } });

    const v1 = buildOpenCode2Config(
      {
        providers: {
          [PROVIDER_ID]: {
            models: { "glm-5.3": { variants: { high: { reasoningEffort: "low" } } } },
          },
        },
      },
      "sk-zro",
      TEST_MODELS,
      true,
    );
    const v1Variants = (v1.providers as Record<string, any>)[PROVIDER_ID].models["glm-5.3"].variants;
    expect(Array.isArray(v1Variants)).toBe(true);
    expect(v1Variants).not.toContainEqual({ id: "high", settings: { reasoningEffort: "low" } });
  });
});

describe("OpenCode 2 launch plan", () => {
  it("isolates config, uses --standalone, and copies user files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-opencode2-home-"));
    const tempDir = path.join(home, "session");
    const userRoot = path.join(home, "config", "opencode");
    await fs.mkdir(path.join(userRoot, "agents"), { recursive: true });
    await fs.writeFile(path.join(userRoot, "agents", "helper.md"), "Helpful agent\n");
    await fs.writeFile(path.join(userRoot, "service.json"), '{"password":"do-not-copy"}\n');
    await fs.writeFile(path.join(userRoot, "auth.json"), '{"token":"do-not-copy"}\n');
    await fs.writeFile(path.join(userRoot, ".env.local"), "TOKEN=do-not-copy\n");
    await fs.writeFile(path.join(userRoot, "agents", ".env.local"), "TOKEN=do-not-copy\n");
    await fs.writeFile(
      path.join(userRoot, "opencode.json"),
      JSON.stringify({ mcp: { servers: { other: { type: "local", command: ["other"] } } } }),
    );

    const plan = await opencode2Tool.launch(
      context(home, tempDir, { XDG_CONFIG_HOME: path.join(home, "config") }),
    );

    expect(plan).toMatchObject({
      tool: "opencode2",
      label: "OpenCode 2",
      command: "opencode2",
      model: "glm-5.3",
      message: "Launch OpenCode 2 with Zro",
    });
    expect(plan.args[0]).toBe("--standalone");
    expect(plan.env?.XDG_CONFIG_HOME).toBe(path.join(tempDir, "xdg"));
    expect(plan.env?.XDG_CONFIG_HOME?.startsWith(tempDir)).toBe(true);
    expect(plan.env).toMatchObject({
      [ZRO_ENV_KEY]: "sk-opencode2-secret",
      DO_NOT_TRACK: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    });

    const configPath = path.join(tempDir, "xdg", "opencode", "opencode.json");
    const configFile = plan.files?.find((file) => file.path === configPath);
    expect(configFile).toBeDefined();
    const config = JSON.parse(String(configFile!.contents)) as Record<string, any>;
    expect(config.model).toBe("zro/glm-5.3");
    expect(config.providers.zro.package).toBe("@opencode/ai/providers/openai-compatible");
    expect(config.mcp.servers.other).toEqual({ type: "local", command: ["other"] });

    expect(
      plan.files?.some((file) => file.path === path.join(tempDir, "xdg", "opencode", "agents", "helper.md")),
    ).toBe(true);

    for (const name of ["service.json", "auth.json", ".env.local"]) {
      expect(plan.files?.some((file) => path.basename(file.path) === name)).toBe(false);
    }
    const copied = (plan.files ?? [])
      .map((file) => typeof file.contents === "string" ? file.contents : Buffer.from(file.contents).toString())
      .join("\n");
    expect(copied).not.toContain("do-not-copy");
  });

  it("does not duplicate --standalone or add it alongside --server", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-opencode2-args-"));

    const standalone = await opencode2Tool.launch(
      context(home, path.join(home, "one"), {}, ["--standalone", "run"]),
    );
    expect(standalone.args).toEqual(["--standalone", "run"]);

    const server = await opencode2Tool.launch(
      context(home, path.join(home, "two"), {}, ["--server", "http://127.0.0.1:4096"]),
    );
    expect(server.args).toEqual(["--server", "http://127.0.0.1:4096"]);

    const debug = await opencode2Tool.launch(
      context(home, path.join(home, "three"), {}, ["debug", "paths", "config"]),
    );
    expect(debug.args).toEqual(["debug", "paths", "config"]);
  });
});

function context(
  homeDir: string,
  tempDir: string,
  env: NodeJS.ProcessEnv = {},
  extraArgs: string[] = [],
): LaunchContext {
  return {
    apiKey: "sk-opencode2-secret",
    apiKeySource: "env",
    env,
    model: "glm-5.3",
    models: TEST_MODELS,
    extraArgs,
    homeDir,
    cwd: homeDir,
    tempDir,
    platform: "linux",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}
