import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { hermesTool } from "../src/engine/tools/hermes.js";
import { ZRO_MODELS } from "../src/engine/constants.js";
import type { LaunchContext } from "../src/engine/types.js";
import { yamlSerializer } from "../src/engine/serializers.js";

describe("hermes adapter", () => {
  it("points HERMES_HOME at the generated config directory", async () => {
    const { plan, home } = await buildPlan("win32");
    const expectedHome = path.join(home, "sessions", "session", "home", ".hermes");

    expect(plan.env?.HERMES_HOME).toBe(expectedHome);
    expect(plan.env?.HOME).toBe(path.join(home, "sessions", "session", "home"));
    expect(findFile(plan.files, "config.yaml")).toBe(path.join(expectedHome, "config.yaml"));
  });

  it("keeps the provider entry resolvable: name + base_url", async () => {
    const { plan } = await buildPlan("linux");
    const config = yamlSerializer.parse(findContents(plan.files, "config.yaml")) as {
      custom_providers?: Array<Record<string, unknown>>;
      model?: Record<string, unknown>;
    };

    const provider = config.custom_providers?.find((entry) => entry.name === "zro");
    expect(provider).toBeDefined();
    expect(String(provider?.base_url)).toContain("/v1");
    // Hermes resolves key_env at runtime; the key must never be written to disk.
    expect(JSON.stringify(config)).not.toContain("sk-hermes-secret");
    expect(provider?.key_env).toBe("ZRO_API_KEY");
    // Hermes' first-run guard counts `model.provider`/`model.base_url` as configured.
    expect(config.model?.provider).toBe("zro");
    expect(config.model?.base_url).toContain("/v1");
    expect(config.model?.default).toBe("glm-5.2");
  });

  it("stores the api key in the config when it came from a stored credential", async () => {
    const { plan } = await buildPlan("win32", "stored");
    const config = yamlSerializer.parse(findContents(plan.files, "config.yaml")) as {
      custom_providers?: Array<Record<string, unknown>>;
    };

    const provider = config.custom_providers?.find((entry) => entry.name === "zro");
    expect(provider?.api_key).toBe("sk-hermes-secret");
    expect(provider?.key_env).toBeUndefined();
  });
});

async function buildPlan(platform: NodeJS.Platform, apiKeySource: "env" | "stored" = "env") {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-hermes-"));
  const tempDir = path.join(home, "sessions", "session");
  const plan = await hermesTool.launch(context(home, tempDir, platform, apiKeySource));
  return { plan, home };
}

function context(
  homeDir: string,
  tempDir: string,
  platform: NodeJS.Platform,
  apiKeySource: "env" | "stored",
): LaunchContext {
  return {
    apiKey: "sk-hermes-secret",
    apiKeySource,
    env: {},
    model: "glm-5.2",
    models: ZRO_MODELS,
    extraArgs: [],
    homeDir,
    cwd: homeDir,
    tempDir,
    platform,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}

function findFile(files: { path: string }[] | undefined, basename: string): string {
  const file = files?.find((candidate) => path.basename(candidate.path) === basename);
  if (!file) throw new Error(`Missing ${basename}`);
  return file.path;
}

function findContents(files: { path: string; contents: string }[] | undefined, basename: string): string {
  const file = files?.find((candidate) => path.basename(candidate.path) === basename);
  if (!file) throw new Error(`Missing ${basename}`);
  return file.contents;
}