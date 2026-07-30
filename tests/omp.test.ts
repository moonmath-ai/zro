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
  ZRO_ENV_KEY,
  ZRO_MODELS,
} from "../src/engine/constants.js";
import { yamlSerializer } from "../src/engine/serializers.js";
import { ompTool } from "../src/engine/tools/omp.js";
import type { LaunchContext, LaunchFile } from "../src/engine/types.js";
import { run } from "../src/run.js";
import type { RunIo, SpawnProcess } from "../src/types.js";

describe("Oh My Pi adapter", () => {
  it("builds an isolated, privacy-safe profile with every Zro model", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-omp-home-"));
    const tempDir = path.join(home, "session");
    const userAgentDir = path.join(home, "user-omp", "agent");
    const sourceConfig = `
theme:
  dark: titanium
statusLine:
  preset: compact
modelRoles:
  default: other/secret-model
enabledModels:
  - other/*
startup:
  checkUpdate: true
marketplace:
  autoUpdate: auto
dev:
  autoqa: true
auth:
  broker:
    token: user-secret
`;
    await fs.mkdir(path.join(userAgentDir, "agents"), { recursive: true });
    await fs.mkdir(path.join(userAgentDir, "skills", "safe"), { recursive: true });
    await fs.mkdir(path.join(userAgentDir, "skills", "node_modules"), { recursive: true });
    await fs.writeFile(path.join(userAgentDir, "config.yml"), sourceConfig);
    await fs.writeFile(path.join(userAgentDir, "agents", "reviewer.md"), "Review carefully\n");
    await fs.writeFile(path.join(userAgentDir, "skills", "safe", "SKILL.md"), "Safe skill\n");
    await fs.writeFile(path.join(userAgentDir, "skills", "safe", ".env.local"), "TOKEN=do-not-copy\n");
    await fs.writeFile(path.join(userAgentDir, "skills", "node_modules", "ignored.js"), "ignored\n");
    await fs.writeFile(path.join(userAgentDir, "agent.db"), "private database\n");
    const outside = path.join(home, "outside.md");
    await fs.writeFile(outside, "outside\n");
    if (process.platform !== "win32") {
      await fs.symlink(outside, path.join(userAgentDir, "agents", "linked.md"));
    }

    const ctx = context(home, tempDir, {
      PI_CODING_AGENT_DIR: userAgentDir,
      OMP_PROFILE: "work",
      OMP_AUTH_BROKER_URL: "https://broker.invalid",
      OMP_AUTH_BROKER_TOKEN: "broker-secret",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.invalid",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.invalid",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=otel-secret",
    });
    const plan = await ompTool.launch(ctx);

    expect(plan).toMatchObject({
      tool: "omp",
      label: "Oh My Pi",
      command: "omp",
      model: "glm-5.2",
      args: ["--print", "hello"],
    });
    for (const key of [
      "HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_STATE_HOME",
      "PI_CODING_AGENT_DIR",
      "PI_CONFIG_FILES",
    ]) {
      expect(plan.env?.[key]?.startsWith(tempDir)).toBe(true);
    }
    expect(plan.env).toMatchObject({
      PI_CONFIG_DIR: ".omp",
      OMP_PROFILE: "",
      PI_PROFILE: "",
      OMP_AUTH_BROKER_URL: "",
      OMP_AUTH_BROKER_TOKEN: "",
      OMP_AUTH_BROKER_SNAPSHOT_TTL_MS: "0",
      PI_AUTO_QA: "0",
      PI_AUTO_QA_PUSH: "0",
      PI_AUTO_QA_PUSH_URL: "",
      PI_AUTO_QA_PUSH_TOKEN: "",
      OTEL_SDK_DISABLED: "true",
      OTEL_TRACES_EXPORTER: "none",
      OTEL_LOGS_EXPORTER: "none",
      OTEL_METRICS_EXPORTER: "none",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_HEADERS: "",
      DO_NOT_TRACK: "1",
      NO_UPDATE_NOTIFIER: "1",
      ZRO_MCP_AUTHORIZATION: "Bearer sk-omp-secret",
      [ZRO_ENV_KEY]: "sk-omp-secret",
    });

    const config = parseYamlFile(plan.files, "config.yml");
    expect(config).toEqual({
      theme: { dark: "titanium" },
      statusLine: { preset: "compact" },
    });
    expect(JSON.stringify(config)).not.toContain("user-secret");
    expect(config).not.toHaveProperty("modelRoles");
    expect(config).not.toHaveProperty("enabledModels");
    expect(config).not.toHaveProperty("startup");
    expect(config).not.toHaveProperty("marketplace");
    expect(config).not.toHaveProperty("dev");
    expect(config).not.toHaveProperty("auth");

    const overlay = parseYamlFile(plan.files, "zro.yml") as Record<string, any>;
    expect(overlay).toMatchObject({
      enabledModels: [`${PROVIDER_ID}/*`],
      modelRoles: {
        default: `${PROVIDER_ID}/glm-5.2:max`,
        smol: `${PROVIDER_ID}/glm-5.2:max`,
        slow: `${PROVIDER_ID}/glm-5.2:max`,
        plan: `${PROVIDER_ID}/glm-5.2:max`,
      },
      startup: {
        quiet: true,
        showSplash: false,
        setupWizard: false,
        checkUpdate: false,
      },
      marketplace: { autoUpdate: "off" },
      dev: {
        autoqa: false,
        autoqaConsent: "denied",
        autoqaPush: { endpoint: "" },
      },
      memory: { backend: "off" },
      memories: { enabled: false },
      compaction: { remoteEnabled: false },
    });

    const modelsConfig = parseYamlFile(plan.files, "models.yml") as Record<string, any>;
    const provider = modelsConfig.providers[PROVIDER_ID];
    expect(provider).toMatchObject({
      baseUrl: BASE_URL,
      apiKey: ZRO_ENV_KEY,
      api: "openai-completions",
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        maxTokensField: "max_tokens",
      },
    });
    expect(JSON.stringify(modelsConfig)).not.toContain("sk-omp-secret");
    expect(provider.models).toHaveLength(ZRO_MODELS.length);
    for (const model of ZRO_MODELS) {
      const actual = provider.models.find((candidate: any) => candidate.id === model.id);
      expect(actual).toMatchObject({
        id: model.id,
        name: model.displayName,
        reasoning: true,
        thinking: { mode: "effort" },
        input: ["text"],
        contextWindow: model.contextWindow,
        maxTokens: model.maxOutputTokens,
      });
    }

    const miniMax = provider.models.find((candidate: any) => candidate.id === "minimax-m3");
    expect(miniMax.thinking).toEqual({
      mode: "effort",
      efforts: ["medium", "high"],
      defaultLevel: "medium",
    });
    expect(miniMax.compat).toEqual({
      reasoningEffortMap: { medium: "adaptive", high: "enabled" },
      thinkingFormat: "zai",
    });

    const glm = provider.models.find((candidate: any) => candidate.id === "glm-5.2");
    expect(glm.thinking).toEqual({
      mode: "effort",
      efforts: ["minimal", "high", "max"],
      defaultLevel: "max",
    });
    expect(glm.compat).toEqual({
      reasoningEffortMap: { minimal: "none", high: "high", max: "max" },
    });

    const kimi = provider.models.find((candidate: any) => candidate.id === "kimi-k2.7-code");
    expect(kimi.thinking).toEqual({
      mode: "effort",
      efforts: ["high"],
      defaultLevel: "high",
    });
    expect(kimi.compat).toEqual({ reasoningEffortMap: { high: "high" } });

    const mcpFile = findFile(plan.files, "mcp.json");
    const mcp = JSON.parse(String(mcpFile.contents));
    expect(mcp.mcpServers[PROVIDER_ID]).toEqual({
      type: "http",
      url: MCP_URL,
      headers: { Authorization: "ZRO_MCP_AUTHORIZATION" },
      enabled: true,
    });
    expect(JSON.stringify(mcp)).not.toContain("sk-omp-secret");

    const plannedPaths = plan.files?.map((file) => file.path) ?? [];
    expect(plannedPaths.some((file) => file.endsWith(path.join("agents", "reviewer.md")))).toBe(true);
    expect(plannedPaths.some((file) => file.endsWith(path.join("skills", "safe", "SKILL.md")))).toBe(true);
    expect(plannedPaths.some((file) => file.endsWith("linked.md"))).toBe(false);
    expect(plannedPaths.some((file) => file.endsWith(".env.local"))).toBe(false);
    expect(plannedPaths.some((file) => file.includes("node_modules"))).toBe(false);
    expect(plannedPaths.some((file) => file.endsWith("agent.db"))).toBe(false);
    expect(await fs.readFile(path.join(userAgentDir, "config.yml"), "utf8")).toBe(sourceConfig);

    const withoutCredential = {
      ...plan,
      env: {
        ...plan.env,
        [ZRO_ENV_KEY]: "[environment only]",
        ZRO_MCP_AUTHORIZATION: "[environment only]",
      },
    };
    expect(JSON.stringify(withoutCredential)).not.toContain("sk-omp-secret");
  });

  it("rejects malformed user config without writing a session profile", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-omp-invalid-"));
    const userAgentDir = path.join(home, ".omp", "agent");
    const tempDir = path.join(home, "session");
    await fs.mkdir(userAgentDir, { recursive: true });
    await fs.writeFile(path.join(userAgentDir, "config.yml"), "theme: [invalid");

    await expect(ompTool.launch(context(home, tempDir))).rejects.toThrow();
    await expect(fs.access(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps dry-run output secret-safe and writes no session files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-omp-preview-"));
    const stdout = new PassThrough();
    const cache = path.join(home, "cache");
    const code = await run(["omp", "--json"], {
      stdin: new PassThrough(),
      stdout,
      stderr: new PassThrough(),
      homeDir: home,
      cwd: home,
      env: {
        ZRO_API_KEY: "sk-preview-secret",
        XDG_CACHE_HOME: cache,
      },
      platform: "linux",
    });

    expect(code).toBe(0);
    const output = await streamText(stdout);
    expect(output).not.toContain("sk-preview-secret");
    const preview = JSON.parse(output) as Record<string, any>;
    expect(preview).toMatchObject({ tool: "omp", command: "omp", model: "minimax-m3" });
    expect(preview.environment.ZRO_API_KEY).not.toContain("preview-secret");
    expect(preview.environment.ZRO_MCP_AUTHORIZATION).not.toContain("preview-secret");
    await expect(fs.access(path.join(cache, "zro", "sessions"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["success", 0, 0],
    ["nonzero exit", 7, 7],
    ["spawn failure", "error", 1],
  ] as const)("cleans its temporary profile after %s", async (_name, childResult, expectedCode) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-omp-cleanup-"));
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
      },
      platform: "linux",
      spawn,
      fetch: async () => new Response(null, { status: 200 }),
    };

    expect(await run(["omp"], io)).toBe(expectedCode);
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
    apiKey: "sk-omp-secret",
    apiKeySource: "env",
    env,
    model: "glm-5.2",
    extraArgs: ["--print", "hello"],
    homeDir,
    cwd: homeDir,
    tempDir,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}

function findFile(files: LaunchFile[] | undefined, basename: string): LaunchFile {
  const file = files?.find((candidate) => path.basename(candidate.path) === basename);
  if (!file) throw new Error(`Missing ${basename}`);
  return file;
}

function parseYamlFile(files: LaunchFile[] | undefined, basename: string): Record<string, unknown> {
  return yamlSerializer.parse(String(findFile(files, basename).contents)) as Record<string, unknown>;
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
