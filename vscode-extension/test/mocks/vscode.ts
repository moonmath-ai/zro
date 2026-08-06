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

// Lightweight mock Progress used when unit-testing the chat provider response path.
export class Progress<T> {
  constructor(
    public readonly report: (part: T) => void = () => {
      /* no-op */
    }
  ) {}
}

export const lm = {};