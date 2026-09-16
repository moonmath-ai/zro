/**
 * Minimal runtime stand-in for the `vscode` module so unit tests can import the
 * extension sources without a real VS Code host. `@types/vscode` supplies the
 * types; this module supplies just the classes and enums the sources touch at
 * runtime (mostly via `instanceof` guards).
 */

export enum LanguageModelChatMessageRole {
  User = "user",
  Assistant = "assistant",
  System = "system"
}

export enum LanguageModelChatToolMode {
  Auto = "auto",
  Required = "required"
}

/** Guard class used by the provider to recognise streaming text parts. */
export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: unknown
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public readonly callId: string,
    public readonly content: Array<LanguageModelTextPart | string | unknown>
  ) {}
}

/**
 * Data-carrying response part. The provider uses this to report token usage
 * (mime type `"usage"`) after the last content part.
 */
export class LanguageModelDataPart {
  constructor(
    public readonly data: Uint8Array,
    public readonly mimeType: string
  ) {}
}

// Lightweight mock Progress used when unit-testing the chat provider response path.
export class Progress<T> {
  constructor(
    public readonly report: (part: T) => void = () => {
      /* no-op */
    }
  ) {}
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3
}

/**
 * In-memory configuration store. Tests seed values with `__setConfig` and read
 * back what the sources wrote, so settings-driven code can be exercised without
 * a VS Code host.
 */
const configStore = new Map<string, unknown>();

export function __setConfig(section: string, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    configStore.set(`${section}.${key}`, value);
  }
}

export function __resetConfig(): void {
  configStore.clear();
}

export function __getConfigSnapshot(): Record<string, unknown> {
  return Object.fromEntries(configStore);
}

class WorkspaceConfiguration {
  constructor(private readonly section: string) {}

  get<T>(key: string, fallback?: T): T | undefined {
    const value = configStore.get(`${this.section}.${key}`);
    return value === undefined ? fallback : (value as T);
  }

  async update(key: string, value: unknown): Promise<void> {
    const full = `${this.section}.${key}`;
    if (value === undefined) configStore.delete(full);
    else configStore.set(full, value);
  }
}

export const workspace = {
  getConfiguration: (section: string) => new WorkspaceConfiguration(section)
};

export const lm = {};