import { spawn as nodeSpawn } from "node:child_process";
import {
  constants as cryptoConstants,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENDPOINT_ROOT, ZRO_ENV_KEY } from "./engine/constants.js";
import {
  credentialFilePath,
  deleteStoredApiKey,
  maskKey,
  promptHidden,
  readStoredApiKey,
  resolveApiKey,
  writeStoredApiKey
} from "./engine/key.js";
import { claudeTool } from "./engine/tools/claude.js";
import {
  codexAppCredentialFilePath,
  codexAppTool,
  codexTool,
} from "./engine/tools/codex.js";
import { grokTool } from "./engine/tools/grok.js";
import { hermesTool } from "./engine/tools/hermes.js";
import { kiloTool } from "./engine/tools/kilo.js";
import { ompTool } from "./engine/tools/omp.js";
import { openClawTool } from "./engine/tools/openclaw.js";
import { opencodeTool } from "./engine/tools/opencode.js";
import { piTool } from "./engine/tools/pi.js";
import type { LaunchPlan, SpawnProcess, ToolId, ToolModule } from "./engine/types.js";
import { parseArgs } from "./args.js";
import { describeTool, TOOLS } from "./catalog.js";
import { commandExists, ensureHarnessInstalled, install } from "./install.js";
import { readPreferences, writePreferences } from "./preferences.js";
import {
  CatalogAuthenticationError,
  invalidateModelCatalog,
  loadModelCatalog,
  type ModelCatalog,
} from "./model-catalog.js";
import type { CliRequest, RunIo } from "./types.js";
import { banner, chooseConnectMethod, chooseTool, helpText, isTty, modelName, theme } from "./ui.js";

const tools: Record<ToolId, ToolModule> = {
  claude: claudeTool,
  codex: codexTool,
  "codex-app": codexAppTool,
  grok: grokTool,
  hermes: hermesTool,
  kilo: kiloTool,
  omp: ompTool,
  openclaw: openClawTool,
  opencode: opencodeTool,
  pi: piTool
};

const PACKAGE_VERSION = (
  JSON.parse(fsSync.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

export async function run(argv: string[], io: RunIo = defaultIo()): Promise<number> {
  if ((io.platform ?? process.platform) === "win32") {
    io.stderr.write("zro supports macOS and Linux. Use WSL on Windows.\n");
    return 1;
  }

  let request: CliRequest;
  try {
    request = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${messageOf(error)}\n`);
    return 1;
  }

  const env = io.env ?? process.env;
  const colors = theme(io.stdout, env);

  if (request.command === "help") {
    io.stdout.write(helpText(colors));
    return 0;
  }
  if (request.command === "version") {
    io.stdout.write(request.output === "json"
      ? `${JSON.stringify({ version: io.version ?? PACKAGE_VERSION })}\n`
      : `${io.version ?? PACKAGE_VERSION}\n`);
    return 0;
  }
  if (request.command === "install") return install(request, io, env);
  if (request.command === "login") return login(request, io, env, colors);
  if (request.command === "logout") return logout(request.output, io, env);
  if (request.command === "status") return status(request.output, io, env, colors);
  if (request.command === "models") return models(request.output, io, env, colors);

  if (request.command === "home") {
    if (!isTty(io.stdin) || !isTty(io.stdout)) {
      io.stdout.write(helpText(colors));
      return 0;
    }
    io.stdout.write(`${banner(colors)}\n\n`);
    try {
      const tool = await chooseTool(io.stdin, io.stdout, colors);
      request = {
        command: "launch",
        tool,
        dryRun: false,
        output: "human",
        extraArgs: []
      };
    } catch (error) {
      if (messageOf(error) !== "Cancelled.") io.stderr.write(`${messageOf(error)}\n`);
      return messageOf(error) === "Cancelled." ? 0 : 1;
    }
  }

  if (request.command === "again") {
    const preferences = await readPreferences({ homeDir: io.homeDir, env });
    if (!preferences.lastTool || !preferences.lastModel) {
      io.stderr.write("Nothing to reopen yet. Start with: zro claude\n");
      return 1;
    }
    request = {
      command: "launch",
      tool: preferences.lastTool,
      model: preferences.lastModel,
      dryRun: request.dryRun,
      output: request.output,
      extraArgs: []
    };
  }

  if (request.install && !request.dryRun) {
    const ready = await ensureHarnessInstalled(request.tool, io, env);
    if (!ready) return 1;
  }

  return launch(request, io, env, colors);
}

async function launch(
  request: Extract<CliRequest, { command: "launch" }>,
  io: RunIo,
  env: NodeJS.ProcessEnv,
  colors: ReturnType<typeof theme>
): Promise<number> {
  let key;
  try {
    key = await resolveApiKey({ flagValue: request.apiKey, env, homeDir: io.homeDir });
  } catch (error) {
    if (!isTty(io.stdin) || !isTty(io.stdout)) {
      io.stderr.write("Not logged in. Run zro login or set ZRO_API_KEY.\n");
      return 1;
    }
    io.stdout.write(`${colors.strong("Connect once to keep going.")}\n\n`);
    const loggedIn = await loginWithWebsite({
      command: "login",
      method: "browser",
      openBrowser: true,
      output: "human",
    }, io, env, colors);
    if (loggedIn !== 0) return loggedIn;
    try {
      key = await resolveApiKey({ env, homeDir: io.homeDir });
    } catch (resolutionError) {
      io.stderr.write(`${messageOf(resolutionError)}\n`);
      return 1;
    }
  }

  if (request.apiKey) {
    io.stderr.write(`Note: --api-key can land in shell history. Prefer zro login or ${ZRO_ENV_KEY}.\n`);
  }

  let catalog: ModelCatalog;
  try {
    catalog = await loadModelCatalog({
      apiKey: key.apiKey,
      env,
      homeDir: io.homeDir,
      fetch: io.fetch,
      cacheRemote: !request.dryRun,
    });
  } catch (error) {
    if (error instanceof CatalogAuthenticationError) {
      io.stderr.write(
        `Authentication failed: ${error.message} Run zro login --manual with a valid API key. Agent was not started.\n`,
      );
      return 1;
    }
    io.stderr.write(`Could not load the Zro model catalog: ${messageOf(error)}\n`);
    return 1;
  }

  const model = request.model ?? catalog.default;
  if (!catalog.models.some((candidate) => candidate.id === model)) {
    io.stderr.write(`Unknown model "${model}". Run zro models.\n`);
    return 1;
  }

  const tempRoot = path.join(env.XDG_CACHE_HOME || path.join(io.homeDir, ".cache"), "zro", "sessions");
  const tempDir = path.join(tempRoot, `session-${process.pid}-${Date.now()}`);
  let plan: LaunchPlan;
  try {
    plan = await tools[request.tool].launch({
      apiKey: key.apiKey,
      apiKeySource: key.source,
      env,
      model,
      models: catalog.models,
      extraArgs: request.extraArgs,
      homeDir: io.homeDir,
      cwd: io.cwd,
      tempDir,
      stdin: io.stdin,
      stdout: io.stdout,
      stderr: io.stderr
    });
  } catch (error) {
    io.stderr.write(`${messageOf(error)}\n`);
    await fs.rm(tempDir, { recursive: true, force: true });
    return 1;
  }

  if (request.dryRun) {
    printPreview(plan, request.output, io, key.apiKey, colors);
    await fs.rm(tempDir, { recursive: true, force: true });
    return 0;
  }

  if (!await verifyApiKey(key.apiKey, io, env)) {
    await fs.rm(tempDir, { recursive: true, force: true });
    return 1;
  }

  try {
    await writePreferences(
      { homeDir: io.homeDir, env },
      { lastTool: request.tool, lastModel: model, updatedAt: new Date().toISOString() }
    );
  } catch (error) {
    if (request.output === "human") {
      io.stderr.write(`Could not remember this session: ${messageOf(error)}\n`);
    }
  }
  if (request.output === "human" && isTty(io.stdout)) {
    io.stdout.write(
      `${colors.accent("◆")} ${colors.strong(describeTool(request.tool).name)}  ` +
      `${colors.muted(`${modelName(model, catalog.models)} · ${model}`)}\n` +
      `${colors.muted(`  ${compactPath(io.cwd, io.homeDir)}`)}\n\n`
    );
  }

  try {
    await writeLaunchFiles(plan);
    return await spawnPlan(plan, io, env);
  } catch (error) {
    io.stderr.write(`Could not open ${plan.label}: ${messageOf(error)}\n`);
    return 1;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function verifyApiKey(
  apiKey: string,
  io: RunIo,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const fetcher = io.fetch ?? globalThis.fetch;
  const endpointRoot = (env.ZRO_ENDPOINT_ROOT || ENDPOINT_ROOT).replace(/\/+$/, "");
  const validationUrl = `${endpointRoot}/v1/models`;

  let response: Response;
  try {
    response = await fetcher(validationUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    io.stderr.write(
      `Could not verify Zro authentication at ${endpointRoot}: ${messageOf(error)}. Agent was not started.\n`,
    );
    return false;
  }

  const status = response.status;
  try {
    await response.body?.cancel();
  } catch {
    // The status is sufficient for this preflight; the response body is intentionally ignored.
  }

  if (response.ok) return true;

  if (status === 401 || status === 403) {
    await invalidateModelCatalog({ env, homeDir: io.homeDir }).catch(() => {});
    io.stderr.write(
      `Authentication failed: Zro rejected the API key (HTTP ${status}). ` +
      `Run zro login --manual with a valid API key. Agent was not started.\n`,
    );
    return false;
  }

  io.stderr.write(
    `Could not verify Zro authentication: HTTP ${status} from ${validationUrl}. ` +
    "Agent was not started.\n",
  );
  return false;
}

async function login(
  request: Extract<CliRequest, { command: "login" }>,
  io: RunIo,
  env: NodeJS.ProcessEnv,
  colors: ReturnType<typeof theme>
): Promise<number> {
  let method = request.method;
  let showWebsiteBanner = true;

  if (method === "choose") {
    if (request.output === "human" && isTty(io.stdin) && isTty(io.stdout)) {
      io.stdout.write(`${banner(colors)}\n\n`);
      try {
        method = await chooseConnectMethod(io.stdin, io.stdout, colors);
      } catch (error) {
        if (messageOf(error) !== "Cancelled.") io.stderr.write(`${messageOf(error)}\n`);
        return messageOf(error) === "Cancelled." ? 0 : 1;
      }
      showWebsiteBanner = false;
    } else {
      method = "browser";
    }
  }

  if (method === "browser") {
    return loginWithWebsite(request, io, env, colors, showWebsiteBanner);
  }
  return loginWithApiKey(request.apiKey, request.output, io, env);
}

async function loginWithApiKey(
  apiKeyFlag: string | undefined,
  output: "human" | "json",
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<number> {
  let apiKey = apiKeyFlag ?? env[ZRO_ENV_KEY];
  if (!apiKey) {
    try {
      apiKey = await promptHidden("API key  ", io.stdin, io.stdout);
    } catch (error) {
      io.stderr.write(`${messageOf(error)}\n`);
      return 1;
    }
  }
  const trimmed = apiKey.trim();
  if (!trimmed) {
    io.stderr.write("No API key entered.\n");
    return 1;
  }
  const filePath = await writeStoredApiKey({ apiKey: trimmed, homeDir: io.homeDir, env });
  if (apiKeyFlag) io.stderr.write("Note: --api-key can land in shell history. Interactive login is safer.\n");
  io.stdout.write(output === "json"
    ? `${JSON.stringify({ connected: true, source: "stored", path: filePath })}\n`
    : `Logged in. Your key is stored securely.\nTry: zro claude\n`);
  return 0;
}

type DeviceLoginStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

async function loginWithWebsite(
  request: Extract<CliRequest, { command: "login" }>,
  io: RunIo,
  env: NodeJS.ProcessEnv,
  colors: ReturnType<typeof theme>,
  showBanner = true,
): Promise<number> {
  const fetcher = io.fetch ?? globalThis.fetch;
  const authRoot = getAuthRoot(env);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  let started: DeviceLoginStart;
  try {
    const response = await fetcher(`${authRoot}/api/cli/auth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        // Machine names can contain personal or corporate information. Only
        // send a user-supplied label; otherwise use a generic description.
        deviceName: env.ZRO_DEVICE_NAME || "Terminal",
      }),
    });
    const payload = await responseJson(response);
    if (!response.ok) {
      const detail = errorFromPayload(payload, "Could not start website login.");
      throw new Error(`${detail} (HTTP ${response.status} from ${authRoot})`);
    }
    started = validateDeviceLoginStart(payload);
  } catch {
    if (request.output === "human" && isTty(io.stdin) && isTty(io.stdout)) {
      io.stdout.write("Website sign-in is unavailable.\nPaste your Zro API key to continue.\n\n");
      return loginWithApiKey(undefined, request.output, io, env);
    }
    io.stderr.write("Website sign-in is unavailable. Run zro login --manual to enter an API key.\n");
    return 1;
  }

  const approvalUrl = browserApprovalUrl(started.verificationUriComplete, env);

  let opened = false;
  if (request.openBrowser) {
    opened = await (io.openBrowser
      ? io.openBrowser(approvalUrl)
      : openBrowserWithSystem(approvalUrl, io.platform ?? process.platform));
  }

  if (request.output === "human") {
    if (showBanner) io.stdout.write(`${banner(colors)}\n\n`);
    io.stdout.write(`${colors.strong(opened ? "Finish signing in in your browser" : "Open this page to sign in")}\n`);
    io.stdout.write(`  ${approvalUrl}\n\n`);
    io.stdout.write(`  Code  ${colors.accent(started.userCode)}\n\n`);
    io.stdout.write(`${colors.muted("Waiting for approval…")}\n`);
  }

  const sleep = io.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const expiresAt = Date.now() + started.expiresIn * 1000;
  const intervalMs = Math.max(1, started.interval) * 1000;
  while (Date.now() < expiresAt) {
    await sleep(intervalMs);
    let response: Response;
    let payload: unknown;
    try {
      response = await fetcher(`${authRoot}/api/cli/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: started.deviceCode }),
      });
      payload = await responseJson(response);
    } catch {
      continue;
    }
    if (response.status === 202) continue;
    if (!response.ok) {
      io.stderr.write(`${errorFromPayload(payload, "Website login failed.")}\n`);
      return 1;
    }

    const encryptedToken = asRecord(payload).encryptedToken;
    if (typeof encryptedToken !== "string") {
      io.stderr.write("Website login returned an invalid credential.\n");
      return 1;
    }
    let apiKey: string;
    try {
      apiKey = privateDecrypt(
        {
          key: privateKey,
          padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(encryptedToken, "base64"),
      ).toString("utf8");
    } catch {
      io.stderr.write("Could not decrypt the website credential for this terminal.\n");
      return 1;
    }
    if (!apiKey.trim()) {
      io.stderr.write("Website login returned an empty credential.\n");
      return 1;
    }

    const filePath = await writeStoredApiKey({ apiKey: apiKey.trim(), homeDir: io.homeDir, env });
    io.stdout.write(request.output === "json"
      ? `${JSON.stringify({ connected: true, source: "website", path: filePath })}\n`
      : `${colors.good("Logged in")} — you can close the browser.\nTry: zro claude\n`);
    return 0;
  }

  io.stderr.write("Website login expired. Run zro login to try again.\n");
  return 1;
}

async function logout(
  output: "human" | "json",
  io: RunIo,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const [storedKeyRemoved, codexAppKeyRemoved] = await Promise.all([
    deleteStoredApiKey({ homeDir: io.homeDir, env }),
    deleteOptionalFile(codexAppCredentialFilePath(io.homeDir)),
    invalidateModelCatalog({ homeDir: io.homeDir, env }),
  ]);
  const removed = storedKeyRemoved || codexAppKeyRemoved;
  io.stdout.write(output === "json"
    ? `${JSON.stringify({ connected: Boolean(env[ZRO_ENV_KEY]), storedKeyRemoved: removed, environmentKeySet: Boolean(env[ZRO_ENV_KEY]) })}\n`
    : removed ? "Logged out. Stored key removed.\n" : "No stored login to remove.\n");
  if (env[ZRO_ENV_KEY] && output === "human") {
    io.stdout.write(`${ZRO_ENV_KEY} is still set in this shell.\n`);
  }
  return 0;
}

async function deleteOptionalFile(filePath: string): Promise<boolean> {
  try {
    await fs.rm(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function status(
  output: "human" | "json",
  io: RunIo,
  env: NodeJS.ProcessEnv,
  colors: ReturnType<typeof theme>
): Promise<number> {
  const stored = await readStoredApiKey({ homeDir: io.homeDir, env });
  const envKey = env[ZRO_ENV_KEY];
  const source = envKey ? "environment" : stored ? "stored" : "none";
  const credential = envKey ?? stored;
  const preferences = await readPreferences({ homeDir: io.homeDir, env });
  const [installed, accountResult] = await Promise.all([
    Promise.all(TOOLS.map(async (tool) => ({
      id: tool.id,
      name: tool.name,
      installed: await commandExists(tool.executable, env)
    }))),
    credential
      ? fetchAccountStatus(credential, io, env)
      : Promise.resolve({ state: "not_connected" } as const),
  ]);
  const connected = source !== "none" && accountResult.state !== "rejected";
  if (accountResult.state === "rejected") {
    await invalidateModelCatalog({ homeDir: io.homeDir, env }).catch(() => {});
  }
  if (output === "json") {
    io.stdout.write(`${JSON.stringify({
      connected,
      credentialSource: source,
      credentialPath: credentialFilePath({ homeDir: io.homeDir, env }),
      accountStatus: accountResult.state,
      account: accountResult.state === "available" ? accountResult.account : null,
      lastSession: preferences.lastTool && preferences.lastModel
        ? { tool: preferences.lastTool, model: preferences.lastModel }
        : null,
      tools: installed
    }, null, 2)}\n`);
    return 0;
  }

  io.stdout.write(`${banner(colors)}\n\n`);
  io.stdout.write(`${!connected ? colors.muted("◇") : colors.good("◆")} Connection  `);
  io.stdout.write(source === "none"
    ? `${colors.muted("not logged in")}\n  Run zro login\n`
    : accountResult.state === "rejected"
      ? `${colors.muted("API key rejected")}\n  Run zro login --manual\n`
    : `${colors.strong(source)} ${colors.muted(`· ${maskKey(credential!)}`)}\n`);
  if (accountResult.state === "available") {
    printAccountStatus(accountResult.account, io, colors);
  } else if (accountResult.state === "unavailable") {
    io.stdout.write(`${colors.muted("◇")} Account     ${colors.muted("details unavailable")}\n`);
  }
  if (preferences.lastTool && preferences.lastModel) {
    io.stdout.write(`${colors.accent("◆")} Last session  ${describeTool(preferences.lastTool).name} ${colors.muted(`· ${preferences.lastModel}`)}\n`);
  } else {
    io.stdout.write(`${colors.muted("◇")} Last session  ${colors.muted("none yet")}\n`);
  }
  io.stdout.write("\nTools\n");
  for (const tool of installed) {
    io.stdout.write(`  ${tool.installed ? colors.good("◆") : colors.muted("◇")} ${pad(tool.name, 13)} ${tool.installed ? "ready" : colors.muted("not installed")}\n`);
  }
  return 0;
}

type AccountStatus = {
  key: { id: string; alias: string };
  billing: {
    status: string;
    currency: string;
    plan: {
      id: string;
      name: string;
      allowance: number;
      used: number;
      remaining: number;
    } | null;
    usagePacks: { total: number; used: number; remaining: number };
    totalRemaining: number;
  };
  activity30d: {
    requests: number;
    modelRequests: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens: number;
    spend: number;
  };
};

type AccountStatusResult =
  | { state: "available"; account: AccountStatus }
  | { state: "rejected" }
  | { state: "unavailable" };

async function fetchAccountStatus(
  apiKey: string,
  io: RunIo,
  env: NodeJS.ProcessEnv,
): Promise<AccountStatusResult> {
  const fetcher = io.fetch ?? globalThis.fetch;
  const endpointRoot = getAuthRoot(env);
  try {
    const response = await fetcher(`${endpointRoot}/api/cli/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      return { state: "rejected" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { state: "unavailable" };
    }
    const account = parseAccountStatus(await responseJson(response));
    return account ? { state: "available", account } : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

function getAuthRoot(env: NodeJS.ProcessEnv): string {
  return (env.ZRO_AUTH_URL || env.ZRO_ENDPOINT_ROOT || ENDPOINT_ROOT).replace(/\/+$/, "");
}

function browserApprovalUrl(serverUrl: string, env: NodeJS.ProcessEnv): string {
  const publicRoot = env.ZRO_PUBLIC_URL || env.ZRO_AUTH_URL;
  if (!publicRoot) return serverUrl;

  const url = new URL(serverUrl);
  return new URL(`${url.pathname}${url.search}${url.hash}`, new URL(publicRoot)).toString();
}

function parseAccountStatus(value: unknown): AccountStatus | null {
  const root = asRecord(value);
  const key = asRecord(root.key);
  const billing = asRecord(root.billing);
  const packs = asRecord(billing.usagePacks);
  const activity = asRecord(root.activity30d);
  const planValue = billing.plan;
  const plan = planValue === null ? null : asRecord(planValue);
  if (
    typeof key.id !== "string" || typeof key.alias !== "string" ||
    typeof billing.status !== "string" || typeof billing.currency !== "string" ||
    !hasNumbers(packs, ["total", "used", "remaining"]) ||
    !hasNumbers(billing, ["totalRemaining"]) ||
    !hasNumbers(activity, [
      "requests", "modelRequests", "toolCalls", "inputTokens", "outputTokens",
      "totalTokens", "cacheReadInputTokens", "spend",
    ]) ||
    (plan !== null && (
      typeof plan.id !== "string" || typeof plan.name !== "string" ||
      !hasNumbers(plan, ["allowance", "used", "remaining"])
    ))
  ) return null;

  return value as AccountStatus;
}

function hasNumbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function printAccountStatus(
  account: AccountStatus,
  io: RunIo,
  colors: ReturnType<typeof theme>,
): void {
  const plan = account.billing.plan;
  io.stdout.write("\nAccount\n");
  io.stdout.write(
    `  ${colors.good("◆")} Plan         ${plan ? colors.strong(plan.name) : colors.muted("none")} ` +
    `${colors.muted(`· ${account.billing.status}`)}\n`,
  );
  if (plan) {
    io.stdout.write(
      `  ${colors.good("◆")} Plan usage   ${money(plan.used, account.billing.currency)} of ` +
      `${money(plan.allowance, account.billing.currency)} · ${money(plan.remaining, account.billing.currency)} left\n`,
    );
  }
  const packs = account.billing.usagePacks;
  io.stdout.write(
    `  ${packs.remaining > 0 ? colors.good("◆") : colors.muted("◇")} Usage packs  ` +
    `${money(packs.remaining, account.billing.currency)} left · ${money(packs.total, account.billing.currency)} total\n`,
  );
  io.stdout.write(
    `  ${colors.good("◆")} Available    ${money(account.billing.totalRemaining, account.billing.currency)} total\n`,
  );
  io.stdout.write(
    `  ${colors.muted("◇")} Last 30 days ${formatInteger(account.activity30d.requests)} requests · ` +
    `${formatInteger(account.activity30d.totalTokens)} tokens\n`,
  );
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

async function models(
  output: "human" | "json",
  io: RunIo,
  env: NodeJS.ProcessEnv,
  colors: ReturnType<typeof theme>,
): Promise<number> {
  let apiKey: string | undefined;
  try {
    apiKey = (await resolveApiKey({ env, homeDir: io.homeDir })).apiKey;
  } catch {
    // A cached or bundled catalog remains useful before the user signs in.
  }

  let catalog: ModelCatalog;
  try {
    catalog = await loadModelCatalog({ apiKey, env, homeDir: io.homeDir, fetch: io.fetch });
  } catch (error) {
    if (error instanceof CatalogAuthenticationError) {
      io.stderr.write(`Authentication failed: ${error.message} Run zro login --manual with a valid API key.\n`);
      return 1;
    }
    io.stderr.write(`Could not load the Zro model catalog: ${messageOf(error)}\n`);
    return 1;
  }

  if (output === "json") {
    io.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`${banner(colors)}\n\nModels\n`);
  for (const model of catalog.models) {
    const isDefault = model.id === catalog.default;
    io.stdout.write(`\n  ${isDefault ? colors.accent("◆") : colors.muted("◇")} ${colors.strong(model.displayName)}  ${colors.muted(model.id)}${isDefault ? colors.accent("  default") : ""}\n`);
    io.stdout.write(`    ${formatTokens(model.contextWindow)} context · ${formatTokens(model.maxOutputTokens)} max output · ${model.reasoning.levels.map((level) => level.id).join(" / ")}\n`);
  }
  io.stdout.write("\nChoose per session with -m, for example: zro codex -m glm-5.2\n");
  return 0;
}

function printPreview(
  plan: LaunchPlan,
  output: "human" | "json",
  io: RunIo,
  secret: string,
  colors: ReturnType<typeof theme>
): void {
  const safeEnv = Object.fromEntries(
    Object.entries(plan.env ?? {}).map(([key, value]) => [key, redact(key, value, secret)])
  );
  const result = {
    tool: plan.tool,
    model: plan.model,
    command: plan.command,
    args: plan.args,
    environment: safeEnv,
    files: (plan.files ?? []).map((file) => ({ path: file.path, persistent: Boolean(file.persistent) }))
  };
  if (output === "json") {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  io.stdout.write(`${banner(colors)}\n\n${colors.strong("Session preview")}\n`);
  io.stdout.write(`  Tool     ${describeTool(plan.tool).name}\n`);
  io.stdout.write(`  Model    ${modelName(plan.model)} ${colors.muted(`· ${plan.model}`)}\n`);
  io.stdout.write(`  Command  ${shellPreview([plan.command, ...plan.args])}\n`);
  const entries = Object.entries(safeEnv);
  if (entries.length) {
    io.stdout.write("  Environment\n");
    for (const [key, value] of entries) io.stdout.write(`    ${key}=${value}\n`);
  }
  if (result.files.length) {
    io.stdout.write("  Session files\n");
    for (const file of result.files) io.stdout.write(`    ${file.path}${file.persistent ? " (persistent)" : ""}\n`);
  }
  io.stdout.write(`\n${colors.muted("Nothing was launched or written.")}\n`);
}

async function writeLaunchFiles(plan: LaunchPlan): Promise<void> {
  for (const file of plan.files ?? []) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.contents, { mode: 0o600 });
  }
}

async function spawnPlan(plan: LaunchPlan, io: RunIo, env: NodeJS.ProcessEnv): Promise<number> {
  const spawn = io.spawn ?? (nodeSpawn as SpawnProcess);
  const child = spawn(plan.command, plan.args, {
    cwd: io.cwd,
    env: { ...env, ...(plan.env ?? {}) },
    stdio: "inherit"
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (typeof code === "number") resolve(code);
      else {
        io.stderr.write(`Agent exited from signal ${signal ?? "unknown"}.\n`);
        resolve(1);
      }
    });
  });
}

function redact(key: string, value: string, secret: string): string {
  if (/KEY|TOKEN|SECRET|AUTH/i.test(key) || value.includes(secret)) return maskKey(value);
  return value;
}

function shellPreview(argv: string[]): string {
  return argv.map((value) => /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`).join(" ");
}

function compactPath(cwd: string, homeDir: string): string {
  return cwd === homeDir ? "~" : cwd.startsWith(`${homeDir}${path.sep}`) ? `~${cwd.slice(homeDir.length)}` : cwd;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
  return `${Math.round(value / 1_000)}K`;
}

function pad(value: string, width: number): string {
  return value + " ".repeat(Math.max(1, width - value.length));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openBrowserWithSystem(url: string, platform: NodeJS.Platform): Promise<boolean> {
  const command = platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;
  if (!command) return false;

  return new Promise((resolve) => {
    const child = nodeSpawn(command, [url], { detached: true, stdio: "ignore" });
    let settled = false;
    child.once("error", () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve(true);
    });
  });
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function validateDeviceLoginStart(value: unknown): DeviceLoginStart {
  const result = asRecord(value);
  if (
    typeof result.deviceCode !== "string" ||
    typeof result.userCode !== "string" ||
    typeof result.verificationUri !== "string" ||
    typeof result.verificationUriComplete !== "string" ||
    typeof result.expiresIn !== "number" ||
    typeof result.interval !== "number"
  ) {
    throw new Error("Website returned an invalid login session.");
  }
  return result as DeviceLoginStart;
}

function errorFromPayload(value: unknown, fallback: string): string {
  const error = asRecord(value).error;
  return typeof error === "string" && error ? error : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function defaultIo(): RunIo {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    homeDir: os.homedir(),
    cwd: process.cwd(),
    env: process.env,
    spawn: nodeSpawn as SpawnProcess,
    platform: process.platform,
    version: PACKAGE_VERSION
  };
}
