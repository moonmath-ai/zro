import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { withZroQueueHeader, ZRO_QUEUE_HEADER } from "../src/engine/constants.js";
import { json5Serializer, yamlSerializer } from "../src/engine/serializers.js";
import { claudeTool } from "../src/engine/tools/claude.js";
import { codexAppTool, codexTool } from "../src/engine/tools/codex.js";
import { grokTool } from "../src/engine/tools/grok.js";
import { hermesTool } from "../src/engine/tools/hermes.js";
import { kiloTool } from "../src/engine/tools/kilo.js";
import { ompTool } from "../src/engine/tools/omp.js";
import { openClawTool } from "../src/engine/tools/openclaw.js";
import { opencodeTool } from "../src/engine/tools/opencode.js";
import { piTool } from "../src/engine/tools/pi.js";
import { primeTool } from "../src/engine/tools/prime.js";
import type { LaunchContext, LaunchPlan } from "../src/engine/types.js";
import { TEST_MODELS } from "./fixtures.js";

describe("queue selection", () => {
  it("uses native request headers without changing the model id", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-queue-"));
    const ctx = context(home);

    const claude = await claudeTool.launch(ctx);
    expect(claude.model).toBe("glm-5.3");
    expect(claude.env?.ANTHROPIC_CUSTOM_HEADERS).toBe(`${ZRO_QUEUE_HEADER}: fast`);

    for (const tool of [codexTool, codexAppTool]) {
      const plan = await tool.launch(ctx);
      expect(plan.model).toBe("glm-5.3");
      expect(fileText(plan, "config.toml")).toContain(
        `http_headers = { "${ZRO_QUEUE_HEADER}" = "fast" }`,
      );
    }

    const grok = await grokTool.launch(ctx);
    expect(fileText(grok, "config.toml")).toContain(
      `extra_headers = { "${ZRO_QUEUE_HEADER}" = "fast" }`,
    );

    const hermes = yamlFile(await hermesTool.launch(ctx), "config.yaml");
    expect(hermes.model.default_headers[ZRO_QUEUE_HEADER]).toBe("fast");

    const kilo = await kiloTool.launch(ctx);
    const kiloOverlay = JSON.parse(kilo.env!.KILO_CONFIG_CONTENT);
    expect(kiloOverlay.provider.zro.options.headers[ZRO_QUEUE_HEADER]).toBe("fast");

    const omp = yamlFile(await ompTool.launch(ctx), "models.yml");
    expect(omp.providers.zro.headers[ZRO_QUEUE_HEADER]).toBe("fast");

    const openClaw = json5File(await openClawTool.launch(ctx), "openclaw.json");
    expect(openClaw.models.providers.zro.models[0].headers[ZRO_QUEUE_HEADER]).toBe("fast");

    const openCode = JSON.parse(fileText(await opencodeTool.launch(ctx), "opencode.json"));
    expect(openCode.provider.zro.options.headers[ZRO_QUEUE_HEADER]).toBe("fast");

    const pi = JSON.parse(fileText(await piTool.launch(ctx), "models.json"));
    expect(pi.providers.zro.headers[ZRO_QUEUE_HEADER]).toBe("fast");

    const prime = JSON.parse(fileText(await primeTool.launch(ctx), "models.json"));
    expect(prime.providers.zro.headers[ZRO_QUEUE_HEADER]).toBe("fast");
  });

  it("omits the header for the default normal queue", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-queue-normal-"));
    const ctx = context(home, "normal");

    expect((await claudeTool.launch(ctx)).env).not.toHaveProperty("ANTHROPIC_CUSTOM_HEADERS");
    for (const tool of [codexTool, codexAppTool]) {
      expect(fileText(await tool.launch(ctx), "config.toml")).not.toContain(ZRO_QUEUE_HEADER);
    }
    expect(fileText(await grokTool.launch(ctx), "config.toml")).not.toContain(ZRO_QUEUE_HEADER);

    const hermes = yamlFile(await hermesTool.launch(ctx), "config.yaml");
    expect(hermes.model.default_headers).not.toHaveProperty(ZRO_QUEUE_HEADER);

    const kilo = JSON.parse((await kiloTool.launch(ctx)).env!.KILO_CONFIG_CONTENT);
    expect(kilo.provider.zro.options.headers).not.toHaveProperty(ZRO_QUEUE_HEADER);

    const omp = yamlFile(await ompTool.launch(ctx), "models.yml");
    expect(omp.providers.zro.headers).not.toHaveProperty(ZRO_QUEUE_HEADER);

    const openClaw = json5File(await openClawTool.launch(ctx), "openclaw.json");
    expect(openClaw.models.providers.zro.models[0].headers).not.toHaveProperty(ZRO_QUEUE_HEADER);

    const openCode = JSON.parse(fileText(await opencodeTool.launch(ctx), "opencode.json"));
    expect(openCode.provider.zro.options.headers).not.toHaveProperty(ZRO_QUEUE_HEADER);

    const pi = JSON.parse(fileText(await piTool.launch(ctx), "models.json"));
    expect(pi.providers.zro.headers).not.toHaveProperty(ZRO_QUEUE_HEADER);

    const prime = JSON.parse(fileText(await primeTool.launch(ctx), "models.json"));
    expect(prime.providers.zro.headers).not.toHaveProperty(ZRO_QUEUE_HEADER);

    expect(withZroQueueHeader({ [ZRO_QUEUE_HEADER]: "fast", preserved: true }, "normal"))
      .toEqual({ preserved: true });
  });
});

function context(homeDir: string, queue = "fast"): LaunchContext {
  return {
    apiKey: "sk-queue-secret",
    apiKeySource: "env",
    env: {},
    model: "glm-5.3",
    queue,
    models: TEST_MODELS,
    extraArgs: [],
    homeDir,
    cwd: homeDir,
    tempDir: path.join(homeDir, "session"),
    platform: "linux",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  };
}

function fileText(plan: LaunchPlan, name: string): string {
  const file = plan.files?.find((candidate) => candidate.path.endsWith(name));
  if (!file) throw new Error(`Missing generated ${name}`);
  return typeof file.contents === "string"
    ? file.contents
    : Buffer.from(file.contents).toString("utf8");
}

function yamlFile(plan: LaunchPlan, name: string): any {
  return yamlSerializer.parse(fileText(plan, name));
}

function json5File(plan: LaunchPlan, name: string): any {
  return json5Serializer.parse(fileText(plan, name));
}
