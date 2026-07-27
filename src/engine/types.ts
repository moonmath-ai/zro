import type { Readable, Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { SUPPORTED_TOOLS } from "./constants.js";

export type ToolId = (typeof SUPPORTED_TOOLS)[number];
export type ApiKeySource = "flag" | "env" | "stored";

export interface LaunchContext {
  apiKey: string;
  apiKeySource: ApiKeySource;
  model: string;
  extraArgs: string[];
  homeDir: string;
  cwd: string;
  tempDir: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

export interface LaunchFile {
  path: string;
  contents: string | Uint8Array;
  persistent?: boolean;
}

export interface LaunchPlan {
  tool: ToolId;
  label: string;
  model: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  files?: LaunchFile[];
  message?: string;
}

export interface ToolModule {
  id: ToolId;
  label: string;
  launch(ctx: LaunchContext): Promise<LaunchPlan>;
}

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: "inherit";
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;
