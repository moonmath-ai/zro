import fs from "node:fs/promises";
import path from "node:path";
import type { Preferences } from "./types.js";

interface PreferenceOptions {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
}

export function preferenceFilePath(options: PreferenceOptions): string {
  const configRoot = options.env?.XDG_CONFIG_HOME || path.join(options.homeDir, ".config");
  return path.join(configRoot, "zro", "preferences.json");
}

export async function readPreferences(options: PreferenceOptions): Promise<Preferences> {
  const filePath = preferenceFilePath(options);
  try {
    const contents = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(contents) as Preferences;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function writePreferences(options: PreferenceOptions, preferences: Preferences): Promise<void> {
  const filePath = preferenceFilePath(options);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
