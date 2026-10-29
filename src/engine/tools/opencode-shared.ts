import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { json5Serializer } from "../serializers.js";
import type { LaunchFile } from "../types.js";
import { asPlainObject } from "./helpers.js";

export const OPENCODE_CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"] as const;
const GENERATED_DIRECTORIES = new Set([".git", "node_modules"]);
const PRIVATE_FILES = new Set(["service.json", "auth.json", "mcp-auth.json"]);

function isPrivateFile(name: string): boolean {
  return PRIVATE_FILES.has(name) || name === ".env" || name.startsWith(".env.");
}

export async function readOpenCodeConfig(configRoot: string): Promise<Record<string, unknown>> {
  let config: Record<string, unknown> = {};
  for (const fileName of OPENCODE_CONFIG_FILES) {
    const contents = await readOptionalFile(path.join(configRoot, fileName), "utf8");
    if (contents === undefined) continue;
    const parsed = json5Serializer.parse(contents) as Record<string, unknown>;
    config = mergeConfig(config, parsed);
  }
  return config;
}

export function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseObject = asPlainObject(merged[key]);
    const overrideObject = asPlainObject(value);
    merged[key] = baseObject && overrideObject
      ? mergeConfig(baseObject, overrideObject)
      : value;
  }
  return merged;
}

export async function collectUserConfigFiles(srcRoot: string, destRoot: string): Promise<LaunchFile[]> {
  const files: LaunchFile[] = [];
  const entries = await readOptionalDirectory(srcRoot);
  if (!entries) return files;

  const configFiles = new Set<string>(OPENCODE_CONFIG_FILES);
  const ancestors = new Set([await fs.realpath(srcRoot)]);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (configFiles.has(entry.name) || GENERATED_DIRECTORIES.has(entry.name) || isPrivateFile(entry.name)) continue;
    await collectPath(
      path.join(srcRoot, entry.name),
      path.join(destRoot, entry.name),
      files,
      ancestors
    );
  }
  return files;
}

async function collectPath(
  srcPath: string,
  destPath: string,
  files: LaunchFile[],
  ancestorDirectories: Set<string>
): Promise<void> {
  const stats = await readOptionalStats(srcPath);
  if (!stats) return;
  if (stats.isFile()) {
    files.push({ path: destPath, contents: await fs.readFile(srcPath) });
    return;
  }
  if (!stats.isDirectory()) return;

  const realPath = await fs.realpath(srcPath);
  if (ancestorDirectories.has(realPath)) return;
  const nextAncestors = new Set(ancestorDirectories).add(realPath);
  const entries = await fs.readdir(srcPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (GENERATED_DIRECTORIES.has(entry.name) || isPrivateFile(entry.name)) continue;
    await collectPath(
      path.join(srcPath, entry.name),
      path.join(destPath, entry.name),
      files,
      nextAncestors
    );
  }
}

async function readOptionalDirectory(dirPath: string): Promise<Dirent[] | undefined> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function readOptionalFile(filePath: string, encoding: "utf8"): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function readOptionalStats(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}
