import { resolveTool, TOOLS } from "./catalog.js";
import type { CliRequest, OutputMode } from "./types.js";

const HELP = new Set(["help", "-h", "--help"]);
const VERSION = new Set(["version", "-v", "--version"]);

export function parseArgs(argv: string[]): CliRequest {
  if (argv.length === 0) return { command: "home", output: "human" };

  if (HELP.has(argv[0])) return { command: "help", output: outputMode(argv) };
  if (VERSION.has(argv[0])) return { command: "version", output: outputMode(argv) };

  const command = argv[0].toLowerCase();
  if (command === "login") {
    const loginArgs = argv.slice(1);
    const manual = loginArgs.includes("--manual");
    const noBrowser = loginArgs.includes("--no-browser");
    const parsed = parseOptions(
      loginArgs.filter((value) => value !== "--manual" && value !== "--no-browser"),
      false,
    );
    assertNoExtraArgs(parsed.extraArgs, command);
    return {
      command: "login",
      apiKey: parsed.apiKey,
      method: manual || parsed.apiKey
        ? "manual"
        : noBrowser || parsed.output === "json"
          ? "browser"
          : "choose",
      openBrowser: !noBrowser,
      output: parsed.output,
    };
  }
  if (command === "logout") {
    const parsed = parseOptions(argv.slice(1), false);
    assertNoExtraArgs(parsed.extraArgs, command);
    return { command: "logout", output: parsed.output };
  }
  if (command === "status" || command === "doctor" || command === "auth") {
    const rest = command === "auth" && argv[1] === "status" ? argv.slice(2) : argv.slice(1);
    const parsed = parseOptions(rest, false);
    assertNoExtraArgs(parsed.extraArgs, command);
    return { command: "status", output: parsed.output };
  }
  if (command === "models") {
    const parsed = parseOptions(argv.slice(1), false);
    assertNoExtraArgs(parsed.extraArgs, command);
    return { command: "models", output: parsed.output };
  }
  if (command === "install") return parseInstallArgs(argv.slice(1));
  if (command === "again") {
    const parsed = parseOptions(argv.slice(1), false);
    assertNoExtraArgs(parsed.extraArgs, command);
    return { command: "again", dryRun: parsed.dryRun, output: parsed.output };
  }
  if (command === "feedback") {
    const parsed = parseOptions(argv.slice(1), false);
    const message = parsed.extraArgs.join(" ").trim() || undefined;
    return { command: "feedback", message, output: parsed.output };
  }

  if (command === "launch" || command === "run") {
    const value = argv[1];
    if (!value) throw new Error(`Choose a tool: ${toolNames()}`);
    const tool = resolveTool(value);
    if (!tool) throw new Error(`Unknown tool "${value}". Choose: ${toolNames()}`);
    const parsed = parseOptions(argv.slice(2), true);
    return { command: "launch", tool, ...parsed };
  }

  const tool = resolveTool(command);
  if (!tool) throw new Error(`Unknown command "${argv[0]}". Run zro help.`);
  const parsed = parseOptions(argv.slice(1), true);
  return { command: "launch", tool, ...parsed };
}

interface ParsedOptions {
  model?: string;
  apiKey?: string;
  dryRun: boolean;
  install?: boolean;
  output: OutputMode;
  extraArgs: string[];
  aliases?: Record<string, string>;
}

function parseOptions(argv: string[], allowPassthrough: boolean): ParsedOptions {
  const result: ParsedOptions = {
    dryRun: false,
    output: "human",
    extraArgs: []
  };
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (passthrough) {
      result.extraArgs.push(value);
      continue;
    }
    if (value === "--") {
      passthrough = true;
      continue;
    }
    if (value === "--model" || value === "-m") {
      result.model = requiredValue(argv, ++index, value);
      continue;
    }
    if (value.startsWith("--model=")) {
      result.model = value.slice("--model=".length);
      continue;
    }
    if (value === "--alias") {
      addAlias(result, requiredValue(argv, ++index, value));
      continue;
    }
    if (value.startsWith("--alias=")) {
      addAlias(result, value.slice("--alias=".length));
      continue;
    }
    if (value === "--api-key") {
      result.apiKey = requiredValue(argv, ++index, value);
      continue;
    }
    if (value.startsWith("--api-key=")) {
      result.apiKey = value.slice("--api-key=".length);
      continue;
    }
    if (value === "--dry-run" || value === "-n") {
      result.dryRun = true;
      continue;
    }
    if (value === "--inspect" || value === "--print") {
      throw new Error(`Unknown Zro option ${value}. Use --dry-run.`);
    }
    if (value === "--install" && allowPassthrough) {
      result.install = true;
      continue;
    }
    if (value === "--json") {
      result.output = "json";
      continue;
    }
    if (value === "-h" || value === "--help") {
      throw new Error("Run zro help for Zro options. Pass tool help after --, for example: zro codex -- --help");
    }
    if (!allowPassthrough) result.extraArgs.push(value);
    else result.extraArgs.push(value);
  }

  if (result.output === "json" && allowPassthrough) result.dryRun = true;
  return result;
}

function parseInstallArgs(argv: string[]): Extract<CliRequest, { command: "install" }> {
  let tool: string | undefined;
  let version: string | undefined;
  let upgrade = false;
  let index = 0;

  if (argv[0] && !argv[0].startsWith("-")) {
    const rawTool = argv[0];
    const separator = rawTool.lastIndexOf("@");
    if (separator > 0) {
      tool = rawTool.slice(0, separator);
      version = rawTool.slice(separator + 1);
      if (!version) throw new Error("A version is required after @.");
    } else {
      tool = rawTool;
    }
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--upgrade") {
      upgrade = true;
      continue;
    }
    if (value === "--version") {
      const next = requiredValue(argv, ++index, value);
      if (version) throw new Error(`Conflicting versions: ${version} and ${next}.`);
      version = next;
      continue;
    }
    throw new Error(`Unexpected argument for install: ${value}`);
  }

  if (!tool && !upgrade) {
    throw new Error("Missing <tool>. Use --upgrade to upgrade zro itself.");
  }
  if (tool && version && upgrade) {
    throw new Error("Choose either a pinned version or --upgrade, not both.");
  }
  return { command: "install", tool, upgrade, version };
}

function addAlias(options: ParsedOptions, pair: string): void {
  const separator = pair.indexOf("=");
  if (separator <= 0) {
    throw new Error("--alias expects SLOT=MODEL, for example: --alias opus=deepseek-v4.1-flash");
  }
  options.aliases ??= {};
  options.aliases[pair.slice(0, separator).toUpperCase()] = pair.slice(separator + 1);
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value === "--") throw new Error(`${option} needs a value.`);
  return value;
}

function outputMode(argv: string[]): OutputMode {
  return argv.includes("--json") ? "json" : "human";
}

function assertNoExtraArgs(args: string[], command: string): void {
  if (args.length) throw new Error(`Unexpected argument for ${command}: ${args[0]}`);
}

function toolNames(): string {
  return TOOLS.map((tool) => tool.id).join(", ");
}
