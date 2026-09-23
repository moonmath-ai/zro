#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_ID = "zro";
const apiKey = process.env.ZRO_API_KEY;
if (!apiKey || apiKey === "ci-fake-key") {
  throw new Error("ZRO_API_KEY must contain a production API key");
}
const zroBin = process.env.ZRO_BIN || "zro";
const reportPath = process.env.ZRO_REPORT || path.resolve("artifacts/zro-models-report.json");
const supportedHarnesses = ["claude", "codex", "grok", "kilo", "omp", "opencode", "pi", "hermes", "openclaw", "prime"];
const requestedHarness = process.argv[2] || "all";
if (requestedHarness !== "all" && !supportedHarnesses.includes(requestedHarness)) {
  throw new Error(`Unknown harness ${requestedHarness}. Expected one of: ${supportedHarnesses.join(", ")}`);
}
const harnesses = requestedHarness === "all" ? supportedHarnesses : [requestedHarness];
const env = {
  ...process.env,
  ZRO_API_KEY: apiKey,
  DO_NOT_TRACK: "1",
  KILO_TELEMETRY_LEVEL: "off",
  KILO_DISABLE_AUTOUPDATE: "1",
  KILO_DISABLE_MODELS_FETCH: "1",
  KILO_DISABLE_SESSION_INGEST: "1",
  KILO_DISABLE_SHARE: "1",
  KILO_DISABLE_DEFAULT_PLUGINS: "1",
  KILO_DISABLE_LSP_DOWNLOAD: "1",
  KILO_DISABLE_EXTERNAL_SKILLS: "1",
  KILO_DISABLE_CLAUDE_CODE: "1",
  KILO_DISABLE_PROJECT_CONFIG: "1",
  KILO_PURE: "1",
  KILO_PERMISSION: '{"*":"deny"}',
  KILO_REMOTE: "0",
  KILO_AUTO_SHARE: "0",
  PI_AUTO_QA: "0",
  PI_AUTO_QA_PUSH: "0",
  OTEL_SDK_DISABLED: "true",
  OTEL_TRACES_EXPORTER: "none",
  OTEL_LOGS_EXPORTER: "none",
  OTEL_METRICS_EXPORTER: "none",
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_HEADERS: "",
  NO_UPDATE_NOTIFIER: "1"
};

const report = {
  generatedAt: new Date().toISOString(),
  mode: "model-discovery",
  harnesses,
  clients: {},
  checks: []
};

try {
  const clientCommands = {
    claude: ["claude", "--version"],
    codex: ["codex", "--version"],
    grok: ["grok", "--version"],
    kilo: ["kilo", "--version"],
    omp: ["omp", "--version"],
    opencode: ["opencode", "--version"],
    pi: ["pi", "--version"],
    hermes: ["hermes", "--version"],
    openclaw: ["openclaw", "--version"],
    prime: ["prime-agent", "--version"]
  };
  for (const name of harnesses) {
    const command = clientCommands[name];
    const output = run(command[0], command.slice(1), `${name} version`);
    report.clients[name] = firstNonEmptyLine(output);
  }
  report.clients.zro = firstNonEmptyLine(run(zroBin, ["--help"], "zro version"));
  const zroCatalog = JSON.parse(run(zroBin, ["models", "--json"], "Zro model catalog"));
  assert.ok(Array.isArray(zroCatalog.models), "Zro model catalog emitted no models");
  const expectedModelIds = zroCatalog.models.map((model) => `${PROVIDER_ID}/${model.id}`).sort();

  if (harnesses.includes("codex")) {
    const codexConfig = await readCodexAppServerConfig("glm-5.3");
    assert.equal(codexConfig.model, "glm-5.3");
    assert.equal(codexConfig.model_provider, "zro");
    assert.equal(typeof codexConfig.model_catalog_json, "string");
    assert.equal(path.basename(codexConfig.model_catalog_json), "zro-models.json");
    assert.equal(codexConfig.model_context_window, 1048576);
    assert.equal(codexConfig.model_reasoning_effort, "xhigh");
    assert.equal(codexConfig.model_providers?.zro?.base_url, "https://zro.moonmath.ai/v1");
    assert.equal(codexConfig.model_providers?.zro?.env_key, "ZRO_API_KEY");
    passed("Codex app server loads the selected Zro model as an isolated custom config");
  }

  if (harnesses.includes("grok")) {
    const grokVersion = run(
      zroBin,
      ["launch", "grok", "--model", "glm-5.3", "--", "--version"],
      "Grok Build isolated launch"
    );
    assert.match(grokVersion, /\d+\.\d+\.\d+/);
    passed("Grok Build launches with an isolated Zro configuration");
  }

  if (harnesses.includes("opencode")) {
    const openCodeOutput = run(
      zroBin,
      ["launch", "opencode", "--model", "glm-5.3", "--", "models", "zro"],
      "OpenCode model list"
    );
    assert.deepEqual(
      openCodeOutput.trim().split(/\r?\n/).filter(Boolean).sort(),
      expectedModelIds
    );
    passed("OpenCode lists all Zro models");
  }

  if (harnesses.includes("kilo")) {
    const kiloOutput = run(
      zroBin,
      ["launch", "kilo", "--model", "glm-5.3", "--", "models", PROVIDER_ID],
      "Kilo Code model list"
    );
    assert.deepEqual(
      kiloOutput.trim().split(/\r?\n/).filter(Boolean).sort(),
      expectedModelIds
    );

    const verboseOutput = run(
      zroBin,
      ["launch", "kilo", "--model", "glm-5.3", "--", "models", PROVIDER_ID, "--verbose"],
      "Kilo Code verbose model list"
    );
    const verboseModels = parseKiloVerboseModels(verboseOutput);
    for (const model of zroCatalog.models) {
      const actual = verboseModels.get(`${PROVIDER_ID}/${model.id}`);
      assert.ok(actual, `Kilo Code omitted verbose metadata for ${model.id}`);
      assert.equal(actual.id, model.id);
      assert.equal(actual.name, model.displayName);
      assert.equal(actual.providerID, PROVIDER_ID);
      assert.equal(actual.capabilities?.reasoning, true);
      assert.equal(actual.capabilities?.toolcall, true);
      assert.equal(actual.limit?.context, model.contextWindow);
      assert.equal(actual.limit?.output, model.maxOutputTokens);
      assert.deepEqual(
        actual.variants,
        Object.fromEntries(model.reasoning.levels.map((level) => [level.id, level.openCodeOptions]))
      );
    }

    const pathsOutput = run(
      zroBin,
      ["launch", "kilo", "--model", "glm-5.3", "--", "debug", "paths"],
      "Kilo Code isolated paths"
    );
    const kiloPaths = parseKiloPaths(pathsOutput);
    assert.equal(typeof kiloPaths.home, "string", "Kilo Code did not report an isolated home path");
    const sessionRoot = path.dirname(kiloPaths.home);
    for (const key of ["home", "data", "bin", "log", "repos", "cache", "config", "state"]) {
      assert.ok(
        kiloPaths[key]?.startsWith(`${sessionRoot}${path.sep}`),
        `Kilo Code ${key} escaped the isolated session: ${kiloPaths[key]}`
      );
    }
    passed("Kilo Code loads every Zro model and keeps runtime state isolated");
  }

  if (harnesses.includes("omp")) {
    const ompOutput = run(
      zroBin,
      ["launch", "omp", "--model", "glm-5.3", "--", "models", PROVIDER_ID, "--json", "--no-extensions"],
      "Oh My Pi model list"
    );
    const ompModels = JSON.parse(ompOutput).models;
    assert.deepEqual(
      ompModels.map((model) => model.selector).sort(),
      expectedModelIds
    );
    for (const model of zroCatalog.models) {
      const actual = ompModels.find((candidate) => candidate.id === model.id);
      assert.ok(actual, `Oh My Pi omitted ${model.id}`);
      assert.equal(actual.provider, PROVIDER_ID);
      assert.equal(actual.name, model.displayName);
      assert.equal(actual.contextWindow, model.contextWindow);
      assert.equal(actual.maxTokens, model.maxOutputTokens);
      assert.equal(actual.reasoning, true);
      assert.ok(Array.isArray(actual.thinking) && actual.thinking.length > 0, `${model.id} has no thinking levels`);
      for (const level of model.reasoning.levels.filter((level) => level.piLevel !== "off")) {
        const expectedLevel = ["minimal", "low", "medium", "high", "xhigh", "max"].includes(level.id)
          ? level.id
          : level.piLevel;
        assert.ok(actual.thinking.includes(expectedLevel), `${model.id} omitted Oh My Pi thinking level ${expectedLevel}`);
      }
    }
    const ompGlm = ompModels.find((model) => model.id === "glm-5.3");
    assert.ok(ompGlm.thinking.includes("minimal"), "GLM-5.3 omitted the Oh My Pi off fallback level");

    const ompConfigPath = run(
      zroBin,
      ["launch", "omp", "--model", "glm-5.3", "--", "config", "path"],
      "Oh My Pi isolated config path"
    ).trim();
    assert.ok(
      ompConfigPath.includes(`${path.sep}zro${path.sep}sessions${path.sep}`),
      `Oh My Pi config escaped the isolated session: ${ompConfigPath}`
    );

    const updateSetting = JSON.parse(run(
      zroBin,
      ["launch", "omp", "--model", "glm-5.3", "--", "config", "get", "startup.checkUpdate", "--json"],
      "Oh My Pi update-check setting"
    ));
    const marketplaceSetting = JSON.parse(run(
      zroBin,
      ["launch", "omp", "--model", "glm-5.3", "--", "config", "get", "marketplace.autoUpdate", "--json"],
      "Oh My Pi marketplace-update setting"
    ));
    assert.equal(updateSetting.value, false);
    assert.equal(marketplaceSetting.value, "off");
    passed("Oh My Pi loads every Zro model with isolated state and update checks disabled");
  }

  if (harnesses.includes("pi")) {
    const piOutput = run(
      zroBin,
      ["launch", "pi", "--model", "glm-5.3", "--", "--list-models", "zro"],
      "Pi model list"
    );
    await assertCatalogModelsPresent(piOutput, "Pi model list");
    passed("Pi lists all Zro models with their context limits");
  }

  if (harnesses.includes("prime")) {
    const primeResult = spawnSync(
      zroBin,
      ["launch", "prime", "--model", "glm-5.3", "--", "model", "list", "zro"],
      { cwd: process.cwd(), env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000 }
    );
    if (primeResult.error) {
      throw new Error(`Prime Agent model list failed to start: ${primeResult.error.message}`);
    }
    if (primeResult.status !== 0) {
      throw new Error(`Prime Agent model list exited ${primeResult.status}\n${redact(primeResult.stderr)}\n${redact(primeResult.stdout)}`.trim());
    }
    const primeOutput = (primeResult.stdout + primeResult.stderr).trim();
    await assertCatalogModelsPresent(primeOutput, "Prime Agent model list");
    passed("Prime Agent lists all Zro models with their context limits");
  }

  if (harnesses.includes("claude")) {
    const claudeLabels = {
      "deepseek-v4.1-flash": "Zro DeepSeek V4.1 Flash",
      "glm-5.3": "Zro GLM-5.3",
      "glm-5.3-flash": "Zro GLM-5.3 Flash",
      "dolly1-security": "Zro Dolly 1 Security",
      "auto": "Zro Auto",
      "kimi-k3": "Zro Kimi K3"
    };
    for (const model of Object.keys(claudeLabels)) {
      run(
        "python3",
        [
          path.join(scriptDir, "check-claude-model-picker.py"),
          model,
          claudeLabels[model],
          ...Object.values(claudeLabels)
        ],
        `Claude Code /model picker (${model})`
      );
      passed(`Claude Code /model lists all Zro models with ${model} selected`);
    }
  }

  report.ok = true;
  writeReport();
  console.log(`All ${report.checks.length} compatibility checks passed for ${harnesses.join(", ")}.`);
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  writeReport();
  throw error;
}

// The live catalog is authoritative, so only assert that every model the CLI
// itself resolves (live, cached, or bundled) is surfaced by the harness as a
// provider-prefixed row with intact capacity columns — never pin the capacity
// values, which the server can change at any time.
async function assertCatalogModelsPresent(output, label) {
  const catalogProcess = spawnSync(zroBin, ["models", "--json"], {
    cwd: process.cwd(), env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000
  });
  if (catalogProcess.status !== 0) {
    throw new Error(`${label}: could not read the Zro catalog via zro models --json`);
  }
  const models = JSON.parse(catalogProcess.stdout).models ?? [];
  const broken = [];
  for (const model of models) {
    const escaped = model.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const row = new RegExp(`^\\s*zro\\s+${escaped}\\s+\\d[\\d.]*[KM]\\s+\\d[\\d.]*[KM]\\s+(yes|no)\\s*$`, "m");
    if (!row.test(output)) broken.push(model.id);
  }
  assert.deepEqual(broken, [], `${label} is missing or has malformed rows for catalog models: ${broken.join(", ")}`);
}

function readCodexAppServerConfig(model) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      zroBin,
      [
        "launch", "codex", "--model", model, "--", "app-server",
        "--disable", "plugins", "--disable", "remote_plugin"
      ],
      {
        cwd: process.cwd(),
        env,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    let config;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex app server config check timed out\n${redact(stderr)}`));
    }, 60_000);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
          child.stdin.write(`${JSON.stringify({
            id: 2,
            method: "config/read",
            params: { includeLayers: false }
          })}\n`);
        } else if (message.id === 2) {
          config = message.result?.config;
          child.stdin.end();
        }
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (config) {
        resolve(config);
      } else {
        reject(new Error(
          `Codex app server config check exited ${code ?? "from signal"}\n${redact(stderr)}`
        ));
      }
    });

    child.stdin.write(`${JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "zro-ci", title: "Zro CI", version: "1" },
        capabilities: { experimentalApi: true }
      }
    })}\n`);
  });
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000
  });

  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} exited ${result.status}\n${redact(result.stderr)}\n${redact(result.stdout)}`.trim()
    );
  }
  return result.stdout.trim();
}

function firstNonEmptyLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() || "installed";
}

function parseKiloVerboseModels(value) {
  const models = new Map();
  for (const section of value.split(/(?=^zro\/[^\r\n]+$)/m)) {
    const [name, ...jsonLines] = section.trim().split(/\r?\n/);
    if (!name?.startsWith(`${PROVIDER_ID}/`) || jsonLines.length === 0) continue;
    let metadata;
    try {
      metadata = JSON.parse(jsonLines.join("\n"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Kilo Code emitted invalid verbose metadata for ${name}: ${message}`);
    }
    models.set(name, metadata);
  }
  return models;
}

function parseKiloPaths(value) {
  return Object.fromEntries(value.split(/\r?\n/).map((line) => {
    const match = /^(home|data|bin|log|repos|cache|config|state)\s+(.+)$/.exec(line.trim());
    return match ? [match[1], match[2]] : undefined;
  }).filter(Boolean));
}

function passed(name) {
  report.checks.push({ name, ok: true });
  console.log(`\u2713 ${name}`);
}

function redact(value = "") {
  return value.replaceAll(env.ZRO_API_KEY, "[REDACTED]").slice(-8000);
}

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
