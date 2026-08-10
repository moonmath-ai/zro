#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const apiKey = process.env.ZRO_API_KEY;
// Max-effort reasoning turns can legitimately take longer than the default
// cache-probe budget. Give the reasoning probes a more generous deadline.
const REASONING_TIMEOUT_MS = 300_000;

// Harnesses that the live-API check does not yet exercise. These are still
// discovered by the matrix (so version + compatibility checks run), but they
// have no cache/reasoning probes. They are recorded as explicitly skipped so
// the report never shows a green `ok: true` with an empty `checks` array.
const SKIPPED_LIVE_HARNESSES = new Set(["hermes", "openclaw"]);
if (!apiKey || apiKey === "ci-fake-key") {
  throw new Error("ZRO_API_KEY must contain a live API test key");
}

const zroBin = process.env.ZRO_BIN || "zro";
const reportPath = process.env.ZRO_REPORT || path.resolve("artifacts/zro-live-report.json");
const runId = (process.env.ZRO_CI_RUN_ID || `${Date.now()}`).replace(/[^A-Za-z0-9_.-]/g, "-");
const supportedHarnesses = ["claude", "codex", "grok", "kilo", "omp", "opencode", "pi", "hermes", "openclaw", "prime"];
const requestedHarness = process.argv[2] || "all";
if (requestedHarness !== "all" && !supportedHarnesses.includes(requestedHarness)) {
  throw new Error(`Unknown harness ${requestedHarness}. Expected one of: ${supportedHarnesses.join(", ")}`);
}
const harnesses = requestedHarness === "all" ? supportedHarnesses : [requestedHarness];
const home = await fs.mkdtemp(path.join(os.tmpdir(), "zro-live-ci-"));
const childEnv = {
  ...process.env,
  HOME: home,
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
  NO_UPDATE_NOTIFIER: "1",
  CI: "1"
};
const report = {
  generatedAt: new Date().toISOString(),
  runId,
  endpoint: "https://zro.moonmath.ai/v1",
  mode: "live-api",
  harnesses,
  clients: {},
  checks: []
};
let testError;

try {
  await collectVersions();
  for (const harness of harnesses) {
    if (harness === "claude") await checkClaude();
    else if (harness === "codex") await checkCodex();
    else if (harness === "grok") await checkGrok();
    else if (harness === "kilo") await checkKilo();
    else if (harness === "omp") await checkOmp();
    else if (harness === "opencode") await checkOpenCode();
    else if (harness === "pi") await checkPi();
    else if (harness === "prime") await checkPrime();
    else if (SKIPPED_LIVE_HARNESSES.has(harness)) skipped(harness);
    else throw new Error(`No live checks defined for harness "${harness}"`);
  }
  report.ok = true;
  console.log(`All ${report.checks.length} live API checks passed for ${harnesses.join(", ")}.`);
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  testError = error;
} finally {
  await writeReport();
  try {
    await fs.rm(home, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  } catch (cleanupError) {
    if (!testError) throw cleanupError;
    const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    console.warn(`Temporary directory cleanup also failed: ${message}`);
  }
}
if (testError) throw testError;

async function collectVersions() {
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
    const result = await run(command[0], command.slice(1), `${name} version`, 30_000);
    report.clients[name] = result.stdout.split(/\r?\n/).find((line) => line.trim())?.trim() || "installed";
  }
}

async function checkClaude() {
  const marker = "ZRO_CLAUDE_CACHE_OK";
  const prompt = `Live cache probe ${runId}. Reply with exactly ${marker}.`;
  const cacheArgs = [
    "launch", "claude", "--model", "glm-5.2", "--",
    "--effort", "none", "--print", "--output-format", "json",
    "--tools", "", "--system-prompt", "You are a CI probe. Do not use tools.", prompt
  ];

  const first = claudeResult(await runZro(cacheArgs, "Claude Code cache warm-up"));
  assert.equal(first.subtype, "success");
  assert.match(first.result, new RegExp(marker));
  const second = claudeResult(await runZro(cacheArgs, "Claude Code cache read"));
  assert.equal(second.subtype, "success");
  assert.match(second.result, new RegExp(marker));
  assert.ok(second.usage.cache_read_input_tokens > 0, "Claude Code reported no cache-read tokens");
  passed("claude.cache", {
    model: "glm-5.2",
    effort: "none",
    firstCacheRead: first.usage.cache_read_input_tokens,
    secondCacheRead: second.usage.cache_read_input_tokens
  });

  const reasoningMarker = "ZRO_CLAUDE_MAX_OK";
  // GLM sometimes answers at max effort without emitting a thinking block.
  // A missing thinking part is model-side flakiness, so retry the probe a
  // few times (later attempts are cheap thanks to prompt caching).
  const maxAttempts = 3;
  let thinking = false;
  for (let attempt = 1; attempt <= maxAttempts && !thinking; attempt++) {
    const reasoning = jsonLines((await runZro([
      "launch", "claude", "--model", "glm-5.2", "--",
      "--effort", "max", "--print", "--output-format", "stream-json", "--verbose",
      "--tools", "", "--system-prompt", "You are a CI probe. Do not use tools.",
      `Think briefly, then include ${reasoningMarker} in the answer.`
    ], `Claude Code max reasoning (attempt ${attempt}/${maxAttempts})`, REASONING_TIMEOUT_MS)).stdout);
    thinking = reasoning.some((event) =>
      event.type === "assistant" && event.message?.content?.some(
        (part) => part.type === "thinking" && typeof part.thinking === "string" && part.thinking.length > 0
      )
    );
    const final = reasoning.findLast((event) => event.type === "result");
    assert.match(final?.result || "", new RegExp(reasoningMarker));
    if (!thinking && attempt < maxAttempts) {
      console.log(`  Claude Code max reasoning returned no thinking content (attempt ${attempt}/${maxAttempts}), retrying...`);
    }
  }
  assert.ok(thinking, "Claude Code max effort returned no thinking content");
  passed("claude.reasoning.max", { model: "glm-5.2", thinkingContent: true });
}

async function checkCodex() {
  await codexUpstreamPreflight();
  const marker = "ZRO_CODEX_CACHE_OK";
  const prompt = `Live cache probe ${runId}. Reply with exactly ${marker}.`;
  const cacheArgs = [
    "launch", "codex", "--model", "glm-5.2", "--", "exec", "--json",
    "--skip-git-repo-check", "--ephemeral",
    "--disable", "plugins", "--disable", "remote_plugin", "--disable", "multi_agent",
    // Codex's default is 5 reconnects of ~35s each (~3 min) per request when
    // the endpoint is saturated. Fail fast and let runZroRetry handle
    // retries with short backoffs instead.
    "-c", "model_providers.zro.stream_max_retries=1",
    "-c", "model_providers.zro.request_max_retries=1",
    "-c", 'model_reasoning_effort="disabled"', prompt
  ];

  const first = codexTurn(await runZroRetry(cacheArgs, "Codex cache warm-up"), marker);
  const second = codexTurn(await runZroRetry(cacheArgs, "Codex cache read"), marker);
  assert.equal(first.usage.reasoning_output_tokens, 0);
  assert.equal(second.usage.reasoning_output_tokens, 0);
  const firstCached = first.usage.cached_input_tokens ?? first.usage.cache_read_input_tokens ?? 0;
  const secondCached = second.usage.cached_input_tokens ?? second.usage.cache_read_input_tokens ?? 0;
  if (!(secondCached > 0)) {
    console.error("Codex cache probe returned unexpected usage:", JSON.stringify({ first: first.usage, second: second.usage }, null, 2));
  }
  assert.ok(secondCached > 0, "Codex reported no cached input tokens");
  passed("codex.cache", {
    model: "glm-5.2",
    effort: "disabled",
    firstCacheRead: firstCached,
    secondCacheRead: secondCached
  });

  const reasoningMarker = "ZRO_CODEX_MAX_OK";
  const max = codexTurn(await runZroRetry([
    "launch", "codex", "--model", "deepseek-v4-flash-0731", "--", "exec", "--json",
    "--skip-git-repo-check", "--ephemeral",
    "--disable", "plugins", "--disable", "remote_plugin", "--disable", "multi_agent",
    "-c", "model_providers.zro.stream_max_retries=1",
    "-c", "model_providers.zro.request_max_retries=1",
    "-c", 'model_reasoning_effort="high"',
    `Think briefly, then include ${reasoningMarker} in the answer.`
  ], "Codex max reasoning", 3, REASONING_TIMEOUT_MS), reasoningMarker);
  passed("codex.reasoning.max", {
    model: "deepseek-v4-flash-0731",
    acceptedEffort: "high",
    reportedReasoningTokens: max.usage.reasoning_output_tokens
  });
}

async function checkGrok() {
  const marker = "ZRO_GROK_JSON_OK";
  const prompt = `Reply with exactly ${marker}.`;
  const json = grokResult(await runZro([
    "launch", "grok", "--model", "glm-5.2", "--",
    "--no-plan", "--no-subagents", "--max-turns", "1",
    "-p", prompt, "--output-format", "json"
  ], "Grok Build JSON output"), marker);
  passed("grok.json", {
    model: "glm-5.2",
    inputTokens: json.usage?.input_tokens
  });

  const streamingMarker = "ZRO_GROK_STREAM_OK";
  const events = jsonLines((await runZro([
    "launch", "grok", "--model", "glm-5.2", "--",
    "--no-plan", "--no-subagents", "--max-turns", "1",
    "-p", `Reply with exactly ${streamingMarker}.`, "--output-format", "streaming-json"
  ], "Grok Build streaming JSON output")).stdout);
  const text = events.filter((event) => event.type === "text").map((event) => event.data || "").join("");
  const end = events.findLast((event) => event.type === "end");
  assert.match(text, new RegExp(streamingMarker));
  assert.ok(end?.usage, "Grok Build streaming output emitted no final usage");
  passed("grok.streaming_json", {
    model: "glm-5.2",
    inputTokens: end.usage.input_tokens
  });
}

async function checkOpenCode() {
  const marker = "ZRO_OPENCODE_CACHE_OK";
  const prompt = `Live cache probe ${runId}. Reply with exactly ${marker}.`;
  const cacheArgs = [
    "launch", "opencode", "--model", "glm-5.2", "--", "run", "--pure",
    "--format", "json", "--model", "zro/glm-5.2", "--variant", "none", prompt
  ];

  const first = openCodeTurn(await runZro(cacheArgs, "OpenCode cache warm-up"), marker);
  const second = openCodeTurn(await runZro(cacheArgs, "OpenCode cache read"), marker);
  assert.equal(first.tokens.reasoning, 0);
  assert.equal(second.tokens.reasoning, 0);
  assert.ok(second.tokens.cache.read > 0, "OpenCode reported no cache-read tokens");
  passed("opencode.cache", {
    model: "glm-5.2",
    effort: "none",
    firstCacheRead: first.tokens.cache.read,
    secondCacheRead: second.tokens.cache.read
  });

  const reasoningMarker = "ZRO_OPENCODE_MAX_OK";
  const max = openCodeTurn(await runZro([
    "launch", "opencode", "--model", "glm-5.2", "--", "run", "--pure",
    "--format", "json", "--model", "zro/glm-5.2", "--variant", "max",
    `Think briefly, then include ${reasoningMarker} in the answer.`
  ], "OpenCode max reasoning", REASONING_TIMEOUT_MS), reasoningMarker);
  assert.ok(max.tokens.reasoning > 0, "OpenCode max effort reported no reasoning tokens");
  passed("opencode.reasoning.max", { model: "glm-5.2", reasoningTokens: max.tokens.reasoning });
}

async function checkKilo() {
  const marker = "ZRO_KILO_CACHE_OK";
  const prompt = `Live cache probe ${runId}. Reply with exactly ${marker}.`;
  const cacheArgs = [
    "launch", "kilo", "--model", "glm-5.2", "--", "run", "--pure",
    "--format", "json", "--model", "zro/glm-5.2", "--variant", "none", prompt
  ];

  const first = kiloTurn(await runZro(cacheArgs, "Kilo Code cache warm-up"), marker);
  const second = kiloTurn(await runZro(cacheArgs, "Kilo Code cache read"), marker);
  assert.equal(first.tokens.reasoning, 0);
  assert.equal(second.tokens.reasoning, 0);
  assert.ok(second.tokens.cache.read > 0, "Kilo Code reported no cache-read tokens");
  passed("kilo.cache", {
    model: "glm-5.2",
    effort: "none",
    firstCacheRead: first.tokens.cache.read,
    secondCacheRead: second.tokens.cache.read
  });

  const reasoningMarker = "ZRO_KILO_MAX_OK";
  const max = kiloTurn(await runZro([
    "launch", "kilo", "--model", "glm-5.2", "--", "run", "--pure",
    "--format", "json", "--model", "zro/glm-5.2", "--variant", "max",
    `Think briefly, then include ${reasoningMarker} in the answer.`
  ], "Kilo Code max reasoning", REASONING_TIMEOUT_MS), reasoningMarker);
  assert.ok(max.tokens.reasoning > 0, "Kilo Code max effort reported no reasoning tokens");
  passed("kilo.reasoning.max", { model: "glm-5.2", reasoningTokens: max.tokens.reasoning });
}

async function checkOmp() {
  const marker = "ZRO_OMP_CACHE_OK";
  const prompt = `Live cache probe ${runId}. Reply with exactly ${marker}.`;
  const cacheArgs = [
    "launch", "omp", "--model", "glm-5.2", "--",
    "--print", "--mode", "json", "--no-tools", "--no-session",
    "--no-extensions", "--no-skills", "--no-rules", "--no-title",
    "--thinking", "off", prompt
  ];

  const first = ompTurn(await runZro(cacheArgs, "Oh My Pi cache warm-up"), marker);
  const second = ompTurn(await runZro(cacheArgs, "Oh My Pi cache read"), marker);
  assert.equal(first.usage.reasoningTokens ?? 0, 0);
  assert.equal(second.usage.reasoningTokens ?? 0, 0);
  assert.ok(second.usage.cacheRead > 0, "Oh My Pi reported no cache-read tokens");
  passed("omp.cache", {
    model: "glm-5.2",
    effort: "off",
    firstCacheRead: first.usage.cacheRead,
    secondCacheRead: second.usage.cacheRead
  });

  const reasoningMarker = "ZRO_OMP_MAX_OK";
  const max = ompTurn(await runZro([
    "launch", "omp", "--model", "glm-5.2", "--",
    "--print", "--mode", "json", "--no-tools", "--no-session",
    "--no-extensions", "--no-skills", "--no-rules", "--no-title",
    "--thinking", "max",
    `Think briefly, then include ${reasoningMarker} in the answer.`
  ], "Oh My Pi max reasoning", REASONING_TIMEOUT_MS), reasoningMarker);
  assert.ok((max.usage.reasoningTokens ?? 0) > 0, "Oh My Pi max effort reported no reasoning tokens");
  passed("omp.reasoning.max", { model: "glm-5.2", reasoningTokens: max.usage.reasoningTokens });
}

async function checkPi() {
  const marker = "ZRO_PI_CACHE_OK";
  const prompt = `Live cache probe ${runId}. Reply with exactly ${marker}.`;
  const cacheArgs = [
    "launch", "pi", "--model", "glm-5.2", "--", "--print", "--mode", "json",
    "--no-tools", "--no-session", "--thinking", "off", prompt
  ];

  const first = piTurn(await runZro(cacheArgs, "Pi cache warm-up"), marker);
  const second = piTurn(await runZro(cacheArgs, "Pi cache read"), marker);
  assert.equal(first.usage.reasoning, 0);
  assert.equal(second.usage.reasoning, 0);
  assert.ok(second.usage.cacheRead > 0, "Pi reported no cache-read tokens");
  passed("pi.cache", {
    model: "glm-5.2",
    effort: "off",
    firstCacheRead: first.usage.cacheRead,
    secondCacheRead: second.usage.cacheRead
  });

  const reasoningMarker = "ZRO_PI_MAX_OK";
  const max = piTurn(await runZro([
    "launch", "pi", "--model", "glm-5.2", "--", "--print", "--mode", "json",
    "--no-tools", "--no-session", "--thinking", "xhigh",
    `Think briefly, then include ${reasoningMarker} in the answer.`
  ], "Pi max reasoning", REASONING_TIMEOUT_MS), reasoningMarker);
  assert.ok(max.usage.reasoning > 0, "Pi max effort reported no reasoning tokens");
  passed("pi.reasoning.max", { model: "glm-5.2", reasoningTokens: max.usage.reasoning });
}

async function checkPrime() {
  const marker = "ZRO_PRIME_CACHE_OK";
  const prompt = `Live cache probe ${runId}. Reply with exactly ${marker}.`;
  const cacheArgs = [
    "launch", "prime", "--model", "glm-5.2", "--", "--print", "--mode", "json",
    "--no-tools", "--no-session", "--thinking", "off", prompt
  ];

  const first = primeTurn(await runZroRetry(cacheArgs, "Prime Agent cache warm-up"), marker, { expectThinking: false });
  await run("prime-agent", ["shutdown", "--force"], "Prime Agent daemon shutdown", 15_000).catch(() => {});
  const second = primeTurn(await runZroRetry(cacheArgs, "Prime Agent cache read"), marker, { expectThinking: false });
  assert.ok(second.usage.cacheRead > 0, "Prime Agent reported no cache-read tokens");
  passed("prime.cache", {
    model: "glm-5.2",
    effort: "off",
    firstCacheRead: first.usage.cacheRead,
    secondCacheRead: second.usage.cacheRead
  });

  const reasoningMarker = "ZRO_PRIME_MAX_OK";
  // Restart the daemon so a wedged session from the cache probes cannot
  // stall the reasoning turn.
  await run("prime-agent", ["shutdown", "--force"], "Prime Agent daemon shutdown", 15_000).catch(() => {});
  // Max-effort GLM turns regularly exceed 300s end-to-end, so give Prime
  // fewer attempts with a longer per-attempt deadline (job budget: 30 min).
  const max = primeTurn(await runZroRetry([
    "launch", "prime", "--model", "glm-5.2", "--", "--print", "--mode", "json",
    "--no-tools", "--no-session", "--thinking", "xhigh",
    `Think briefly, then include ${reasoningMarker} in the answer.`
  ], "Prime Agent max reasoning", 2, 420_000), reasoningMarker, { expectThinking: true });
  assert.ok(max.hasThinking, "Prime Agent max effort returned no thinking content");
  passed("prime.reasoning.max", { model: "glm-5.2", thinkingContent: true });
}

function primeTurn(result, marker, options = {}) {
  const events = jsonLines(`${result.stdout}\n${result.stderr}`);
  const completed = events.findLast(
    (event) => event.type === "message_end" && event.message?.role === "assistant"
  )?.message;
  assert.ok(completed?.usage, "Prime Agent emitted no assistant token usage");
  const text = completed.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  assert.match(text, new RegExp(marker));
  const hasThinking = completed.content.some((part) => part.type === "thinking" && typeof part.thinking === "string" && part.thinking.length > 0);
  if (options.expectThinking === false) {
    assert.ok(!hasThinking, "Prime Agent returned thinking content when reasoning was disabled");
  }
  return { ...completed, hasThinking };
}

function claudeResult(result) {
  const events = jsonLines(result.stdout);
  const event = events.findLast((entry) => entry.type === "result");
  assert.ok(event, "Claude Code emitted no result event");
  return event;
}

// Codex puts a tools array on every turn (hardcoded upstream, no config
// toggle). If the zro Responses endpoint is rejecting tool-bearing requests —
// observed 2026-08-09/10: ANY request with `tools` returned
// 500 "Request failed." while tool-less requests succeeded — every codex call
// fails and codex masks it as "high demand". Probe that path once up front so
// the failure names the real cause in seconds instead of after many retries.
async function codexUpstreamPreflight() {
  const payload = {
    model: "glm-5.2",
    input: "Upstream preflight. Reply with exactly OK.",
    store: false,
    stream: true,
    tools: [
      {
        type: "function",
        name: "ping",
        description: "Reply pong.",
        strict: false,
        parameters: { type: "object", properties: {} }
      }
    ]
  };
  let response;
  try {
    response = await fetch("https://zro.moonmath.ai/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.fail(
      `Codex upstream preflight: POST /v1/responses did not respond (${message}). ` +
        "The zro endpoint is unreachable or hanging — codex cannot work either."
    );
  }
  if (response.ok) {
    await response.body?.cancel().catch(() => {});
    return;
  }
  const body = redact((await response.text().catch(() => "")).slice(0, 400));
  assert.fail(
    `Codex upstream preflight: POST /v1/responses with a single function tool returned ` +
      `${response.status} ${body} — the zro Responses API is rejecting tool-bearing ` +
      "requests (service-side outage; every codex turn sends tools). This is not a " +
      "codex or zro-cli bug: retry CI once the endpoint stops 500ing /v1/responses with tools."
  );
}

function codexTurn(result, marker) {
  const events = jsonLines(result.stdout);
  const failed = events.findLast((event) => event.type === "turn.failed");
  assert.ok(!failed, `Codex turn failed: ${failed?.error?.message || "unknown error"}`);
  const text = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text)
    .join("\n");
  assert.match(text, new RegExp(marker));
  const completed = events.findLast((event) => event.type === "turn.completed");
  assert.ok(completed?.usage, "Codex emitted no completed turn usage");
  return completed;
}

function grokResult(result, marker) {
  let output;
  try {
    output = JSON.parse(result.stdout.trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Grok Build emitted invalid JSON output: ${message}`);
  }
  assert.equal(typeof output.text, "string", "Grok Build JSON output contained no text");
  assert.match(output.text, new RegExp(marker));
  assert.ok(output.usage, "Grok Build JSON output emitted no usage");
  return output;
}

function openCodeTurn(result, marker) {
  const events = jsonLines(result.stdout);
  const text = events
    .filter((event) => event.type === "text")
    .map((event) => event.part?.text || "")
    .join("");
  assert.match(text, new RegExp(marker));
  const completed = events.findLast((event) => event.type === "step_finish");
  assert.ok(completed?.part?.tokens, "OpenCode emitted no step token usage");
  return completed.part;
}

function kiloTurn(result, marker) {
  const events = jsonLines(result.stdout);
  const text = events
    .filter((event) => event.type === "text")
    .map((event) => event.part?.text || "")
    .join("");
  assert.match(text, new RegExp(marker));
  const completed = events.findLast((event) => event.type === "step_finish");
  assert.ok(completed?.part?.tokens, "Kilo Code emitted no step token usage");
  return completed.part;
}

function piTurn(result, marker) {
  const events = jsonLines(result.stdout);
  const completed = events.findLast(
    (event) => event.type === "message_end" && event.message?.role === "assistant"
  )?.message;
  assert.ok(completed?.usage, "Pi emitted no assistant token usage");
  const text = completed.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  assert.match(text, new RegExp(marker));
  return completed;
}

function ompTurn(result, marker) {
  const events = jsonLines(result.stdout);
  const completed = events.findLast(
    (event) => event.type === "message_end" && event.message?.role === "assistant"
  )?.message;
  assert.ok(completed?.usage, "Oh My Pi emitted no assistant token usage");
  const text = completed.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  assert.match(text, new RegExp(marker));
  return completed;
}

function jsonLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

async function runZro(args, label, timeoutMs = 120_000, env = childEnv) {
  return run(zroBin, args, label, timeoutMs, env);
}

async function runZroRetry(args, label, maxAttempts = 3, timeoutMs = 180_000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await run(zroBin, args, `${label} (attempt ${attempt}/${maxAttempts})`, timeoutMs);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && /high demand|Reconnecting|exited 1|timed out/i.test(message)) {
        // 5s backoffs never survive upstream saturation windows (observed:
        // 30+ min of persistent "high demand" errors for one request shape).
        // 30s/60s gives short blips a chance without blowing the job budget.
        console.log(`  ${label} failed (attempt ${attempt}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 30_000 * attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function run(command, args, label, timeoutMs, env = childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 16 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 16 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`${label} failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`${label} exited ${code}\n${redact(stderr)}\n${redact(stdout)}`.trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function passed(name, details) {
  report.checks.push({ name, ok: true, ...details });
  console.log(`\u2713 ${name}`);
}

function skipped(harness) {
  report.checks.push({ name: `${harness}.live`, ok: true, skipped: true, reason: "no live probes defined" });
  console.log(`- ${harness}.live (skipped)`);
}

function redact(value = "") {
  const redacted = value.replaceAll(apiKey, "[REDACTED]");
  if (redacted.length <= 16_000) return redacted;
  const omitted = redacted.length - 16_000;
  return `${redacted.slice(0, 8_000)}\n...[${omitted} characters omitted]...\n${redacted.slice(-8_000)}`;
}

async function writeReport() {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
