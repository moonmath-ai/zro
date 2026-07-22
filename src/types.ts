import type { Readable, Writable } from "node:stream";
import type { SpawnProcess, ToolId } from "./engine/types.js";

export type OutputMode = "human" | "json";

export type CliRequest =
  | { command: "home"; output: OutputMode }
  | { command: "help"; output: OutputMode }
  | { command: "version"; output: OutputMode }
  | {
      command: "connect";
      apiKey?: string;
      method: "browser" | "manual";
      openBrowser: boolean;
      output: OutputMode;
    }
  | { command: "disconnect"; output: OutputMode }
  | { command: "status"; output: OutputMode }
  | { command: "models"; output: OutputMode }
  | { command: "again"; inspect: boolean; output: OutputMode }
  | {
      command: "launch";
      tool: ToolId;
      model?: string;
      apiKey?: string;
      inspect: boolean;
      output: OutputMode;
      extraArgs: string[];
    };

export interface Preferences {
  lastTool?: ToolId;
  lastModel?: string;
  updatedAt?: string;
}

export interface RunIo {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  homeDir: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnProcess;
  platform?: NodeJS.Platform;
  version?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  openBrowser?: (url: string) => Promise<boolean>;
  sleep?: (milliseconds: number) => Promise<void>;
}
