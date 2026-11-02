import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  BASE_URL,
  MCP_URL,
  PROVIDER_ID,
  PROVIDER_NAME,
  ZRO_ENV_KEY,
} from "../src/engine/constants.js";
import { buildDshPatch, dshTool } from "../src/engine/tools/dsh.js";
import type { LaunchContext } from "../src/engine/types.js";
import { TEST_MODELS } from "./fixtures.js";

describe("DeepSeek Harness config", () => {
  it("builds the Zro provider, default model, and MCP patch", () => {
    const patch = parsePatch(buildDshPatch("glm-5.3", TEST_MODELS));
    const provider = (patch[1].config as any).providers[PROVIDER_ID];

    expect(patch[0]).toEqual({
      id: "agent-default-model",
      config: { provider: PROVIDER_ID, model: "glm-5.3" },
    });
    expect(provider).toMatchObject({
      displayName: PROVIDER_NAME,
      apiKeyEnv: ZRO_ENV_KEY,
      api: "openai-completions",
      baseURL: BASE_URL,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        maxTokensField: "max_tokens",
      },
    });
    expect(provider.models[0]).toEqual({
      id: "glm-5.3",
      name: "glm-5.3",
      contextWindow: TEST_MODELS[0].contextWindow,
      maxTokens: TEST_MODELS[0].maxOutputTokens,
      input: ["text"],
      reasoningEfforts: { off: "none", high: "high", xhigh: "max" },
    });
    expect(provider.models[1].input).toEqual(["text", "image"]);

    expect(patch[2].insert).toEqual([
      {
        id: `${PROVIDER_ID}-mcp`,
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          transport: "streamable-http",
          serverName: PROVIDER_ID,
          url: MCP_URL,
          headers: { Authorization: `"Bearer " + process.env.${ZRO_ENV_KEY}` },
        },
      },
    ]);
  });

  it("honors gateway endpoints and omits MCP in no-auth mode", () => {
    const text = buildDshPatch("glm-5.3", TEST_MODELS, {
      baseUrl: "https://gateway.example/v1",
      noAuth: true,
    });
    const patch = parsePatch(text);
    const provider = (patch[1].config as any).providers[PROVIDER_ID];

    expect(provider.baseURL).toBe("https://gateway.example/v1");
    expect(text).not.toContain("/mcp/zro");
    expect(text).not.toContain("Authorization");
  });

  it("isolates DSH_HOME and launches the web profile", async () => {
    const home = "/tmp/zro-dsh-test";
    const plan = await dshTool.launch(context(home));
    const dshHome = path.join(home, "session", "dsh");

    expect(plan).toMatchObject({
      tool: "dsh",
      command: "dsh",
      args: ["web", "--no-open"],
      env: {
        DSH_HOME: dshHome,
        [ZRO_ENV_KEY]: "sk-dsh-secret",
      },
    });
    expect(plan.files?.[0].path).toBe(
      path.join(dshHome, "profiles", "web", "cordis.patch.yml"),
    );
    expect(String(plan.files?.[0].contents)).not.toContain("sk-dsh-secret");
  });
});

function parsePatch(text: string): any[] {
  return YAML.parse(text, { logLevel: "silent" }) as any[];
}

function context(homeDir: string): LaunchContext {
  return {
    apiKey: "sk-dsh-secret",
    apiKeySource: "stored",
    inferenceRoot: "https://zro.moonmath.ai",
    inferenceBaseUrl: BASE_URL,
    mcpUrl: MCP_URL,
    noAuth: false,
    env: {},
    model: "glm-5.3",
    models: TEST_MODELS,
    extraArgs: ["--no-open"],
    homeDir,
    cwd: homeDir,
    tempDir: path.join(homeDir, "session"),
    platform: "linux",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}
