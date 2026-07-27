import type { ToolId } from "./engine/types.js";

export interface ToolDescriptor {
  id: ToolId;
  name: string;
  hint: string;
  aliases: readonly string[];
  executable: string;
  package?: string;
  installer?: {
    url: string;
    args?: readonly string[];
    binDir: string;
  };
}

export const TOOLS: readonly ToolDescriptor[] = [
  { id: "claude", name: "Claude Code", hint: "Anthropic's coding agent", aliases: ["c", "cc"], executable: "claude", package: "@anthropic-ai/claude-code@latest" },
  { id: "codex", name: "Codex CLI", hint: "OpenAI's terminal agent", aliases: ["cx"], executable: "codex", package: "@openai/codex@latest" },
  { id: "codex-app", name: "Codex App", hint: "OpenAI's desktop app", aliases: ["app"], executable: "codex", package: "@openai/codex@latest" },
  { id: "opencode", name: "OpenCode", hint: "Open source coding agent", aliases: ["oc"], executable: "opencode", package: "opencode-ai@latest" },
  { id: "grok", name: "Grok Build", hint: "xAI's coding agent", aliases: ["gr"], executable: "grok", installer: { url: "https://x.ai/cli/install.sh", binDir: ".local/bin" } },
  { id: "hermes", name: "Hermes", hint: "Nous Research's agent", aliases: ["h"], executable: "hermes", installer: { url: "https://hermes-agent.nousresearch.com/install.sh", args: ["--skip-setup"], binDir: ".local/bin" } },
  { id: "openclaw", name: "OpenClaw", hint: "Personal AI assistant", aliases: ["claw"], executable: "openclaw", package: "openclaw@latest" },
  { id: "pi", name: "Pi", hint: "Minimal coding agent", aliases: [], executable: "pi", package: "@earendil-works/pi-coding-agent@latest" }
] as const;

const TOOL_LOOKUP = new Map<string, ToolId>();
for (const tool of TOOLS) {
  TOOL_LOOKUP.set(tool.id, tool.id);
  for (const alias of tool.aliases) TOOL_LOOKUP.set(alias, tool.id);
}

export function resolveTool(value: string): ToolId | undefined {
  return TOOL_LOOKUP.get(value.toLowerCase());
}

export function describeTool(id: ToolId): ToolDescriptor {
  return TOOLS.find((tool) => tool.id === id)!;
}
