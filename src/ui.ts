import { clearScreenDown, emitKeypressEvents, moveCursor } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { ZRO_MODELS } from "./engine/constants.js";
import { TOOLS } from "./catalog.js";
import type { ToolId } from "./engine/types.js";

export interface Theme {
  accent(value: string): string;
  strong(value: string): string;
  muted(value: string): string;
  good(value: string): string;
}

export function theme(stdout: Writable, env: NodeJS.ProcessEnv): Theme {
  const enabled = isTty(stdout) && !("NO_COLOR" in env);
  const paint = (code: string, value: string) => enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return {
    accent: (value) => paint("38;5;135", value),
    strong: (value) => paint("1", value),
    muted: (value) => paint("2", value),
    good: (value) => paint("38;5;78", value)
  };
}

export function banner(colors: Theme): string {
  return `${colors.accent("zro")}  ${colors.muted("your agent, your model, one command")}`;
}

export function helpText(colors: Theme): string {
  return `${banner(colors)}

${colors.strong("Open an agent")}
  zro claude                 Open Claude Code on the default model
  zro codex -m glm-5.2       Pick a model for this session
  zro oc -- --help           Use an alias and pass native arguments
  zro again                  Reopen the last tool and model

${colors.strong("Make it yours")}
  zro connect                Sign in securely with the Zro website
  zro connect --manual       Enter an API key instead
  zro status                 See connection, tools, and last session
  zro models                 Browse the model catalog
  zro claude --inspect       Preview without launching

${colors.strong("Tools")}
  ${TOOLS.map((tool) => tool.id).join("  ")}

For remote machines, use connect --no-browser and open the displayed URL.
Credentials saved by earlier zro versions remain compatible.
`;
}

export function modelName(modelId: string): string {
  return ZRO_MODELS.find((model) => model.id === modelId)?.displayName ?? modelId;
}

export async function chooseTool(stdin: Readable, stdout: Writable, colors: Theme): Promise<ToolId> {
  const choice = await choose({
    stdin,
    stdout,
    title: "What do you want to open?",
    options: TOOLS.map((tool) => ({ value: tool.id, label: tool.name, hint: tool.hint })),
    colors
  });
  return choice as ToolId;
}

async function choose(options: {
  stdin: Readable;
  stdout: Writable;
  title: string;
  options: Array<{ value: string; label: string; hint: string }>;
  colors: Theme;
}): Promise<string> {
  if (!isTty(options.stdin) || !isTty(options.stdout)) {
    throw new Error("Interactive selection needs a terminal. Run zro help for commands.");
  }

  const input = options.stdin as Readable & { isRaw?: boolean; setRawMode?: (mode: boolean) => void };
  const previousRawMode = input.isRaw;
  let selected = 0;
  let renderedLines = 0;
  input.setRawMode?.(true);
  input.resume();
  emitKeypressEvents(input);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (typeof previousRawMode === "boolean") input.setRawMode?.(previousRawMode);
      input.pause();
    };
    const render = () => {
      if (renderedLines) {
        moveCursor(options.stdout, 0, -renderedLines);
        clearScreenDown(options.stdout);
      }
      options.stdout.write(`${options.colors.strong(options.title)}\n`);
      for (const [index, item] of options.options.entries()) {
        const marker = index === selected ? options.colors.accent("◆") : options.colors.muted("◇");
        const label = index === selected ? options.colors.strong(item.label) : item.label;
        options.stdout.write(`  ${marker} ${label}  ${options.colors.muted(item.hint)}\n`);
      }
      options.stdout.write(options.colors.muted("  ↑↓ move · enter open · q cancel") + "\n");
      renderedLines = options.options.length + 2;
    };
    function onKeypress(text: string, key: { ctrl?: boolean; name?: string }) {
      if ((key.ctrl && key.name === "c") || text === "q" || key.name === "escape") {
        options.stdout.write("\n");
        cleanup();
        reject(new Error("Cancelled."));
        return;
      }
      if (key.name === "up") selected = (selected - 1 + options.options.length) % options.options.length;
      else if (key.name === "down") selected = (selected + 1) % options.options.length;
      else if (/^[1-8]$/.test(text)) selected = Number(text) - 1;
      else if (key.name === "return" || key.name === "enter") {
        options.stdout.write("\n");
        const value = options.options[selected].value;
        cleanup();
        resolve(value);
        return;
      } else return;
      render();
    }
    input.on("keypress", onKeypress);
    render();
  });
}

export function isTty(stream: Readable | Writable): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}
