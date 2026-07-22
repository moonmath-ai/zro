import fs from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { ZRO_ENV_KEY } from "./constants.js";
import type { ApiKeySource } from "./types.js";

export interface KeyResolution {
  apiKey: string;
  source: ApiKeySource;
}

interface CredentialOptions {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
}

export function maskKey(apiKey: string): string {
  if (!apiKey) return "****";
  const prefix = apiKey.startsWith("sk-") ? "sk-" : apiKey.slice(0, Math.min(3, apiKey.length));
  const suffix = apiKey.length > 8 ? apiKey.slice(-4) : "";
  return suffix ? `${prefix}****...${suffix}` : `${prefix}****`;
}

export function redactSecrets(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) return current;
    return current.split(secret).join(maskKey(secret));
  }, text);
}

export async function resolveApiKey(options: {
  flagValue?: string;
  env?: NodeJS.ProcessEnv;
  homeDir: string;
}): Promise<KeyResolution> {
  if (options.flagValue) {
    return { apiKey: options.flagValue, source: "flag" };
  }

  const env = options.env ?? process.env;
  const envValue = env[ZRO_ENV_KEY];
  if (envValue) {
    return { apiKey: envValue, source: "env" };
  }

  const stored = await readStoredApiKey({ homeDir: options.homeDir, env });
  if (stored) {
    return { apiKey: stored, source: "stored" };
  }

  throw new Error(`No API key found. Run zro login, set ${ZRO_ENV_KEY}, or pass --api-key.`);
}

export function credentialFilePath(options: CredentialOptions): string {
  const env = options.env ?? process.env;
  const configRoot = env.XDG_CONFIG_HOME || path.join(options.homeDir, ".config");
  return path.join(configRoot, "zro", "credentials.json");
}

export async function readStoredApiKey(options: CredentialOptions): Promise<string | null> {
  const filePath = credentialFilePath(options);

  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as { apiKey?: unknown };
    return typeof parsed.apiKey === "string" && parsed.apiKey.trim() ? parsed.apiKey : null;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(`Stored Zro credentials are not valid JSON at ${filePath}. Run zro login again.`);
    }
    throw error;
  }
}

export async function writeStoredApiKey(options: CredentialOptions & { apiKey: string }): Promise<string> {
  const filePath = credentialFilePath(options);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    filePath,
    `${JSON.stringify({ apiKey: options.apiKey, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 }
  );
  await fs.chmod(path.dirname(filePath), 0o700);
  await fs.chmod(filePath, 0o600);
  return filePath;
}

export async function deleteStoredApiKey(options: CredentialOptions): Promise<boolean> {
  const filePath = credentialFilePath(options);
  try {
    await fs.rm(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function promptHidden(prompt: string, stdin: Readable, stdout: Writable): Promise<string> {
  if (!isTty(stdin) || !isTty(stdout)) {
    throw new Error(`No API key provided. Pass --api-key, set ${ZRO_ENV_KEY}, or run zro login in a terminal.`);
  }

  const input = stdin as Readable & {
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const previousRawMode = input.isRaw;
  let value = "";
  let settled = false;

  input.setRawMode?.(true);
  input.resume();
  stdout.write(prompt);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("data", onData);
      input.off("error", onError);
      input.off("end", onEnd);
      if (typeof previousRawMode === "boolean") input.setRawMode?.(previousRawMode);
      input.pause();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      stdout.write("\n");
      cleanup();
      resolve(value.trim());
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    function onData(chunk: Buffer | string) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const char of text) {
        if (char === "\u0003") {
          stdout.write("\n");
          fail(new Error("Interrupted while reading API key."));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
        stdout.write("*");
      }
    }

    function onError(error: Error) {
      fail(error);
    }

    function onEnd() {
      fail(new Error("No API key entered."));
    }

    input.on("data", onData);
    input.once("error", onError);
    input.once("end", onEnd);
  });
}

function isTty(stream: Readable | Writable): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
