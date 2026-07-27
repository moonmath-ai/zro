#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.ZRO_API_KEY;
if (!apiKey || apiKey === "ci-fake-key") {
  throw new Error("ZRO_API_KEY must contain a production API key");
}
const zroBin = process.env.ZRO_BIN || "zro";
const reportPath = process.env.ZRO_REPORT || path.resolve("artifacts/zro-models-report.json");
const supportedHarnesses = ["claude", "codex", "grok", "opencode", "pi", "hermes", "openclaw"];
const requestedHarness = process.argv[2] || "all";
if (requestedHarness !== "all" && !supportedHarnesses.includes(requestedHarness)) {
  throw new Error(`Unknown harness ${requestedHarness}. Expected one of: ${supportedHarnesses.join(", ")}`);
}
const harnesses = requestedHarness === "all" ? supportedHarnesses : [requestedHarness];
const env = {
  ...process.env,
  ZRO_API_KEY: apiKey,
  DO_NOT_TRACK: "1"
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
    opencode: ["opencode", "--version"],
    pi: ["pi", "--version"],
    hermes: ["hermes", "--version"],
    openclaw: ["openclaw", "--version"]
  };
  for (const name of harnesses) {
    const command = clientCommands[name];
    const output = run(command[0], command.slice(1), `${name} version`);
    report.clients[name] = firstNonEmptyLine(output);
  }
  report.clients.zro = firstNonEmptyLine(run(zroBin, ["--help"], "zro version"));

  if (harnesses.includes("codex")) {
    const codexConfig = await readCodexAppServerConfig("glm-5.2");
    assert.equal(codexConfig.model, "glm-5.2");
    assert.equal(codexConfig.model_provider, "zro");
    assert.equal(typeof codexConfig.model_catalog_json, "string");
    assert.equal(path.basename(codexConfig.model_catalog_json), "zro-models.json");
    assert.equal(codexConfig.model_context_window, 524288);
    assert.equal(codexConfig.model_reasoning_effort, "max");
    assert.equal(codexConfig.model_providers?.zro?.base_url, "https://zro.moonmath.ai/v1");
    assert.equal(codexConfig.model_providers?.zro?.env_key, "ZRO_API_KEY");
    passed("Codex app server loads the selected Zro model as an isolated custom config");
  }

  if (harnesses.includes("grok")) {
    const grokVersion = run(
      zroBin,
      ["launch", "grok", "--model", "glm-5.2", "--", "--version"],
      "Grok Build isolated launch"
    );
    assert.match(grokVersion, /\d+\.\d+\.\d+/);
    passed("Grok Build launches with an isolated Zro configuration");
  }

  if (harnesses.includes("opencode")) {
    const openCodeOutput = run(
      zroBin,
      ["launch", "opencode", "--model", "glm-5.2", "--", "models", "zro"],
      "OpenCode model list"
    );
    assert.deepEqual(
      openCodeOutput.trim().split(/\r?\n/).filter(Boolean).sort(),
      ["zro/glm-5.2", "zro/kimi-k2.7-code", "zro/minimax-m3"]
    );
    passed("OpenCode lists all Zro models");
  }

  if (harnesses.includes("pi")) {
    const piOutput = run(
      zroBin,
      ["launch", "pi", "--model", "glm-5.2", "--", "--list-models", "zro"],
      "Pi model list"
    );
    assert.match(piOutput, /zro\s+glm-5\.2\s+524\.3K\s+64K\s+yes/);
    assert.match(piOutput, /zro\s+minimax-m3\s+1\.0M\s+64K\s+yes/);
    assert.match(piOutput, /zro\s+kimi-k2\.7-code\s+128K\s+64K\s+yes/);
    passed("Pi lists all Zro models with their context limits");
  }

  if (harnesses.includes("claude")) {
    const claudeLabels = {
      "minimax-m3": "Zro MiniMax M3",
      "glm-5.2": "Zro GLM-5.2",
      "kimi-k2.7-code": "Zro Kimi K2.7 Code"
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
