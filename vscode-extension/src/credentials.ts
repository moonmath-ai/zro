import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as vscode from "vscode";
import { ZRO_ENV_KEY } from "./constants.js";

const SECRET_KEY = "zro.apiKey";

export type CredentialSource = "environment" | "stored" | "credentials-file" | "none";

/**
 * Resolution order mirrors zro/src/engine/key.ts:
 *   1. ZRO_API_KEY env var
 *   2. VS Code SecretStorage (set via the management command)
 *   3. ~/.config/zro/credentials.json (written by `zro login`)
 */
export async function resolveApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const envValue = process.env[ZRO_ENV_KEY];
  if (envValue) return envValue;

  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return stored;

  return readCredentialsFile();
}

/** Return the resolved key together with which source provided it. */
export async function resolveCredential(
  context: vscode.ExtensionContext
): Promise<{ apiKey: string | undefined; source: CredentialSource }> {
  const envValue = process.env[ZRO_ENV_KEY];
  if (envValue) return { apiKey: envValue, source: "environment" };

  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return { apiKey: stored, source: "stored" };

  const fileKey = await readCredentialsFile();
  if (fileKey) return { apiKey: fileKey, source: "credentials-file" };

  return { apiKey: undefined, source: "none" };
}

export async function storeApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  await context.secrets.store(SECRET_KEY, apiKey);
}

export async function deleteApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
}

/**
 * Read the API key written by `zro login`. Same path logic as the CLI's
 * credentialFilePath(): ~/.config/zro/credentials.json (respects XDG_CONFIG_HOME).
 */
async function readCredentialsFile(): Promise<string | undefined> {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const filePath = path.join(configRoot, "zro", "credentials.json");
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as { apiKey?: unknown };
    return typeof parsed.apiKey === "string" && parsed.apiKey.trim() ? parsed.apiKey : undefined;
  } catch {
    return undefined;
  }
}

export function maskKey(apiKey: string): string {
  if (!apiKey) return "****";
  const prefix = apiKey.startsWith("sk-") ? "sk-" : apiKey.slice(0, Math.min(3, apiKey.length));
  const suffix = apiKey.length > 8 ? apiKey.slice(-4) : "";
  return suffix ? `${prefix}****...${suffix}` : `${prefix}****`;
}
