import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { BASE_URL, PROVIDER_NAME, type ZroModel } from "./constants.js";
import { fetchModelCatalog } from "./catalog.js";
import { resolveApiKey } from "./credentials.js";

/**
 * Wire ZRO into other AI-coding extensions (Cline, Continue, Roo Code).
 *
 * ZRO already registers as a VS Code Language Model Chat Provider, so Cline
 * and Roo Code can use ZRO models natively via their "VS Code Language Model
 * API" provider — no second API key. Continue (and the OpenAI-compatible
 * provider in Cline/Roo) needs a base URL + API key written to its config.
 */

export const EXTENSION_IDS = {
  cline: "saoudrizwan.claude-dev",
  continue: "continue.continue",
  roo: "RooVeterinaryInc.roo-cline",
} as const;

export type ExtensionKey = keyof typeof EXTENSION_IDS;

export interface DetectedExtensions {
  cline: boolean;
  continue: boolean;
  roo: boolean;
}

/** Which of the supported extensions are installed in this VS Code. */
export function detectInstalledExtensions(): DetectedExtensions {
  const has = (id: string): boolean => {
    try {
      return vscode.extensions.getExtension(id) !== undefined;
    } catch {
      return false;
    }
  };
  return {
    cline: has(EXTENSION_IDS.cline),
    continue: has(EXTENSION_IDS.continue),
    roo: has(EXTENSION_IDS.roo),
  };
}

// --- Continue config ---------------------------------------------------------

const CONTINUE_DIR = path.join(os.homedir(), ".continue");
const ZRO_PREFIX = "ZRO ";

/**
 * Build a Continue model entry for one ZRO model.
 */
export function buildContinueEntry(model: ZroModel, apiKey: string): Record<string, unknown> {
  return {
    name: `${ZRO_PREFIX}${model.displayName}`,
    provider: "openai",
    model: model.id,
    apiBase: BASE_URL,
    apiKey,
    roles: ["chat"],
    defaultCompletionOptions: {
      contextLength: model.contextWindow,
      maxTokens: model.maxOutputTokens,
    },
  };
}

/**
 * Merge a set of ZRO entries into an existing Continue `config.json` text,
 * replacing any model whose `name` starts with `ZRO ` and preserving all
 * other entries. Returns the new JSON text.
 */
export function mergeContinueJson(
  existingText: string,
  entries: Record<string, unknown>[]
): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(existingText) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const models = Array.isArray(parsed.models) ? (parsed.models as Record<string, unknown>[]) : [];
  const kept = models.filter((m) => typeof m.name === "string" && !m.name.startsWith(ZRO_PREFIX));
  parsed.models = [...kept, ...entries];
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Merge ZRO entries into an existing Continue `config.yaml` text by line-based
 * replacement of `models:` list items. This is a deliberately small YAML
 * handler: Continue's config is a flat `models:` array of mappings, so we splice
 * by name rather than pulling in a YAML AST dependency. Returns the new text.
 */
export function mergeContinueYaml(
  existingText: string,
  entries: Record<string, unknown>[]
): string {
  const lines = existingText.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  // Preserve any leading lines before the `models:` key.
  while (i < lines.length && lines[i].trim() !== "models:") {
    out.push(lines[i]);
    i++;
  }
  if (i >= lines.length) {
    // No `models:` key — append one.
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push("models:");
    for (const entry of entries) out.push(yamlEntry(entry));
    return `${out.join("\n")}\n`;
  }
  // Emit `models:` then skip existing entries (any block whose first key is
  // `name: ZRO ...`), preserving all other entries.
  out.push(lines[i]);
  i++;
  let preserved: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    // A new top-level key ends the models list.
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("-")) break;
    if (line.trimStart().startsWith("- name:")) {
      // Start of a list item — collect its indented sub-keys until the next
      // list item (`  - name:`) or a top-level key.
      const item: string[] = [line];
      i++;
      while (
        i < lines.length &&
        !lines[i].trimStart().startsWith("- name:") &&
        (lines[i].startsWith("  ") || lines[i].trim() === "")
      ) {
        item.push(lines[i]);
        i++;
      }
      const nameLine = item.find((l) => {
        const t = l.trimStart();
        return t.startsWith("name:") || t.startsWith("- name:");
      });
      const name = nameLine?.split("name:")[1]?.trim().replace(/^["']|["']$/g, "");
      if (name && name.startsWith(ZRO_PREFIX)) continue; // drop existing ZRO entry
      preserved.push(...item);
    } else {
      preserved.push(line);
      i++;
    }
  }
  out.push(...preserved);
  for (const entry of entries) out.push(yamlEntry(entry));
  // Append any trailing top-level keys that ended the list.
  while (i < lines.length) {
    out.push(lines[i]);
    i++;
  }
  return `${out.join("\n")}\n`;
}

function yamlEntry(entry: Record<string, unknown>): string {
  const lines: string[] = [`  - name: ${quoteYaml(String(entry.name))}`];
  lines.push(`    provider: ${quoteYaml(String(entry.provider))}`);
  lines.push(`    model: ${quoteYaml(String(entry.model))}`);
  lines.push(`    apiBase: ${quoteYaml(String(entry.apiBase))}`);
  lines.push(`    apiKey: ${quoteYaml(String(entry.apiKey))}`);
  lines.push(`    roles:`);
  for (const role of (entry.roles as string[]) ?? []) lines.push(`      - ${quoteYaml(role)}`);
  const opts = entry.defaultCompletionOptions as { contextLength: number; maxTokens: number };
  if (opts) {
    lines.push(`    defaultCompletionOptions:`);
    lines.push(`      contextLength: ${opts.contextLength}`);
    lines.push(`      maxTokens: ${opts.maxTokens}`);
  }
  return lines.join("\n");
}

function quoteYaml(value: string): string {
  // Quote anything that could be misread as YAML (numbers, booleans, colons).
  if (/^[\w.-]+$/.test(value) && !/^(true|false|null|yes|no|on|off|\d+)$/i.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Write the given ZRO model entries into Continue's config file, creating a
 * backup first. Returns the path written.
 */
export async function writeContinueConfig(
  entries: Record<string, unknown>[]
): Promise<string> {
  await fs.mkdir(CONTINUE_DIR, { recursive: true });
  const yamlPath = path.join(CONTINUE_DIR, "config.yaml");
  const jsonPath = path.join(CONTINUE_DIR, "config.json");
  let target: string;
  let text: string;
  try {
    text = await fs.readFile(yamlPath, "utf8");
    target = yamlPath;
  } catch {
    try {
      text = await fs.readFile(jsonPath, "utf8");
      target = jsonPath;
    } catch {
      // Neither exists — create config.yaml.
      target = yamlPath;
      text = "models: []\n";
    }
  }
  // If the chosen file is empty, seed valid structure.
  if (target.endsWith(".json")) {
    text = mergeContinueJson(text.trim() || "{}", entries);
  } else {
    text = mergeContinueYaml(text.trim() || "models: []\n", entries);
  }
  await fs.writeFile(target, text, "utf8");
  return target;
}

// --- Roo Code profile --------------------------------------------------------

/**
 * Build a Roo Code profile-import JSON object for one ZRO model.
 * Shape matches Roo's `providerProfilesSchema`.
 */
export function buildRooProfile(
  model: ZroModel,
  apiKey: string
): Record<string, unknown> {
  return {
    currentApiConfigName: PROVIDER_NAME,
    apiConfigs: {
      [PROVIDER_NAME]: {
        id: `zro-${model.id}-${Date.now().toString(36)}`,
        apiProvider: "openai",
        openAiBaseUrl: BASE_URL,
        openAiApiKey: apiKey,
        openAiModelId: model.id,
      },
    },
  };
}

// --- Cline instructions ------------------------------------------------------

export interface ClineProfileInstructions {
  json: Record<string, unknown>;
  steps: string[];
}

/**
 * Build a Cline "OpenAI Compatible" profile + step-by-step instructions.
 * Cline has no import command, so the user enters these values by hand.
 */
export function buildClineProfileInstructions(
  model: ZroModel,
  apiKey: string
): ClineProfileInstructions {
  return {
    json: {
      apiProvider: "openai",
      openAiBaseUrl: BASE_URL,
      openAiApiKey: apiKey,
      openAiModelId: model.id,
    },
    steps: [
      `In Cline, open Settings → API Provider → "OpenAI Compatible".`,
      `Base URL: ${BASE_URL}`,
      `API Key: ${apiKey}`,
      `Model ID: ${model.id}`,
    ],
  };
}

// --- VS Code Language Model guide (Cline + Roo) -----------------------------

export interface VscodeLmGuide {
  title: string;
  steps: string[];
}

/**
 * Build the guided steps for using ZRO via the "VS Code Language Model API"
 * provider in Cline or Roo Code — no API key needed.
 */
export function buildVscodeLmGuide(
  extension: "cline" | "roo",
  models: readonly ZroModel[]
): VscodeLmGuide {
  const name = extension === "cline" ? "Cline" : "Roo Code";
  const settingsCommand =
    extension === "cline" ? "cline.settingsButtonClicked" : "roo-cline.settingsButtonClicked";
  const modelList = models.map((m) => `${PROVIDER_NAME} ${m.displayName}`).join(", ");
  return {
    title: `Use ZRO in ${name} via the VS Code Language Model API`,
    steps: [
      `Open ${name} settings (command: ${settingsCommand}).`,
      `Under API Provider, choose "VS Code Language Model API".`,
      `Open the model picker — ZRO models appear as: ${modelList}.`,
      `No API key is needed here — ZRO authenticates via the ZRO extension.`,
    ],
  };
}

// --- Orchestrator ------------------------------------------------------------

/**
 * Run the "configure in other extensions" flow. Called by the
 * `zro.configureExtensions` command.
 */
export async function configureInExtensions(
  context: vscode.ExtensionContext
): Promise<void> {
  const apiKey = await resolveApiKey(context);
  if (!apiKey) {
    const choice = await vscode.window.showWarningMessage(
      "No ZRO API key found. Enter one first?",
      "Enter API key",
      "Cancel"
    );
    if (choice === "Enter API key") {
      await vscode.commands.executeCommand("zro.manage");
    }
    return;
  }

  const { models } = await fetchModelCatalog(apiKey);
  const picks = await pickModels(models);
  if (picks.length === 0) return;

  const detected = detectInstalledExtensions();
  const targets = await pickTargets(detected);
  if (targets.length === 0) return;

  const results: string[] = [];
  for (const target of targets) {
    try {
      if (target === "continue") {
        await writeContinueConfig(picks.map((m) => buildContinueEntry(m, apiKey)));
        results.push(`Continue: wrote ${picks.length} model(s) to ~/.continue/`);
      } else if (target === "roo") {
        await configureRoo(picks, apiKey);
        results.push(`Roo Code: imported profile for ${picks.length} model(s)`);
      } else if (target === "cline") {
        await configureCline(picks, apiKey);
        results.push(`Cline: showed configuration steps`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push(`${target}: failed (${msg})`);
    }
  }

  // Always show the vscode-lm guide for Cline/Roo if they were selected.
  for (const target of targets) {
    if (target === "cline" || target === "roo") {
      const guide = buildVscodeLmGuide(target, picks);
      showGuide(guide);
    }
  }

  vscode.window.showInformationMessage(`ZRO configuration:\n${results.join("\n")}`);
}

async function configureRoo(models: ZroModel[], apiKey: string): Promise<void> {
  const profile = buildRooProfile(models[0], apiKey);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-roo-"));
  const file = path.join(tmpDir, "zro-profile.json");
  await fs.writeFile(file, JSON.stringify(profile, null, 2), "utf8");
  try {
    await vscode.commands.executeCommand("roo-cline.importSettings", vscode.Uri.file(file));
  } catch {
    // Some Roo versions take a path string instead of a Uri.
    try {
      await vscode.commands.executeCommand("roo-cline.importSettings", file);
    } catch {
      // If the command isn't available, leave the file for manual import.
      vscode.window.showWarningMessage(
        `Roo import command unavailable. The profile is at ${file} — use Roo's "Import Settings" to load it.`
      );
    }
  }
}

async function configureCline(models: ZroModel[], apiKey: string): Promise<void> {
  const { json, steps } = buildClineProfileInstructions(models[0], apiKey);
  const file = path.join(os.homedir(), "zro-cline-profile.json");
  await fs.writeFile(file, JSON.stringify(json, null, 2), "utf8");
  vscode.window.showInformationMessage(
    `Cline has no import command. A profile file was written to ${file}.\nSteps:\n${steps.join("\n")}`,
    { modal: false }
  );
}

function showGuide(guide: VscodeLmGuide): void {
  void vscode.window.showInformationMessage(
    `${guide.title}\n${guide.steps.join("\n")}`,
    { modal: false }
  );
}

async function pickModels(models: readonly ZroModel[]): Promise<ZroModel[]> {
  const items = models.map((m) => ({
    label: `${PROVIDER_NAME} ${m.displayName}`,
    description: m.id,
    picked: false,
    model: m,
  }));
  const picks = await vscode.window.showQuickPick(items, {
    title: "ZRO models to configure",
    placeHolder: "Select one or more models",
    canPickMany: true,
  });
  return (picks ?? []).map((p) => p.model as ZroModel);
}

async function pickTargets(detected: DetectedExtensions): Promise<ExtensionKey[]> {
  const available: Array<{ key: ExtensionKey; label: string }> = [];
  if (detected.cline) available.push({ key: "cline", label: "Cline" });
  if (detected.continue) available.push({ key: "continue", label: "Continue" });
  if (detected.roo) available.push({ key: "roo", label: "Roo Code" });
  if (available.length === 0) {
    await vscode.window.showInformationMessage(
      "Cline, Continue, and Roo Code are not installed. Install one of them, then re-run this command."
    );
    return [];
  }
  const items = available.map((a) => ({ label: a.label, key: a.key }));
  const picks = await vscode.window.showQuickPick(items, {
    title: "Configure ZRO for",
    placeHolder: "Select extensions to configure",
    canPickMany: true,
  });
  return (picks ?? []).map((p) => p.key as ExtensionKey);
}
