import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  ENDPOINT_ROOT,
  MCP_URL,
  PROVIDER_ID,
  ZRO_MODELS,
} from "../src/engine/constants.js";
import { yamlSerializer } from "../src/engine/serializers.js";
import { hermesTool } from "../src/engine/tools/hermes.js";
import { openClawTool } from "../src/engine/tools/openclaw.js";
import type { LaunchContext, LaunchPlan } from "../src/engine/types.js";

describe("dynamic MCP catalog", () => {
  it("uses the aggregate MCP endpoint by default", () => {
    expect(MCP_URL).toBe(`${ENDPOINT_ROOT}/mcp/`);
  });

  it("removes Hermes' legacy Brave-only allowlist", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-hermes-mcp-"));
    await fs.mkdir(path.join(home, ".hermes"), { recursive: true });
    await fs.writeFile(path.join(home, ".hermes", "config.yaml"), `
mcp_servers:
  zro:
    tools:
      include:
        - zro-web_search
      exclude:
        - user-disabled-tool
`);

    const plan = await hermesTool.launch(context(home));
    const config = yamlSerializer.parse(configContents(plan, "config.yaml")) as Record<string, any>;
    const server = config.mcp_servers[PROVIDER_ID];

    expect(server.url).toBe(MCP_URL);
    expect(server.tools).not.toHaveProperty("include");
    expect(server.tools).toMatchObject({
      exclude: ["user-disabled-tool"],
      resources: false,
      prompts: false,
    });
  });

  it("removes OpenClaw's legacy Brave-only allowlist", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-openclaw-mcp-"));
    await fs.mkdir(path.join(home, ".openclaw"), { recursive: true });
    await fs.writeFile(path.join(home, ".openclaw", "openclaw.json"), JSON.stringify({
      mcp: {
        servers: {
          zro: {
            toolFilter: { include: ["zro-web_search"] },
          },
        },
      },
    }));

    const plan = await openClawTool.launch(context(home));
    const config = JSON.parse(configContents(plan, "openclaw.json")) as Record<string, any>;
    const server = config.mcp.servers[PROVIDER_ID];

    expect(server.url).toBe(MCP_URL);
    expect(server).not.toHaveProperty("toolFilter");
  });
});

function context(homeDir: string): LaunchContext {
  return {
    apiKey: "sk-mcp-test",
    apiKeySource: "env",
    env: {},
    model: ZRO_MODELS[0].id,
    models: ZRO_MODELS,
    extraArgs: [],
    homeDir,
    cwd: homeDir,
    tempDir: path.join(homeDir, "session"),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}

function configContents(plan: LaunchPlan, basename: string): string {
  const file = plan.files?.find((candidate) => path.basename(candidate.path) === basename);
  if (!file) throw new Error(`Missing ${basename}`);
  return String(file.contents);
}
