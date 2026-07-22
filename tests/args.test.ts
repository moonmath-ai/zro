import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("the direct command language", () => {
  it("uses website login by default and keeps manual entry available", () => {
    expect(parseArgs(["connect"])).toEqual({
      command: "connect",
      apiKey: undefined,
      method: "browser",
      openBrowser: true,
      output: "human"
    });
    expect(parseArgs(["connect", "--manual", "--no-browser"])).toMatchObject({
      command: "connect",
      method: "manual",
      openBrowser: false
    });
  });

  it("launches a tool directly with a short model flag", () => {
    expect(parseArgs(["codex", "-m", "glm-5.2", "exec", "hello"])).toEqual({
      command: "launch",
      tool: "codex",
      model: "glm-5.2",
      apiKey: undefined,
      inspect: false,
      output: "human",
      extraArgs: ["exec", "hello"]
    });
  });

  it("supports memorable tool aliases", () => {
    expect(parseArgs(["oc", "--inspect"])).toMatchObject({
      command: "launch",
      tool: "opencode",
      inspect: true
    });
  });

  it("keeps the old launch shape as a migration path", () => {
    expect(parseArgs(["launch", "claude", "--", "--debug"])).toMatchObject({
      command: "launch",
      tool: "claude",
      extraArgs: ["--debug"]
    });
  });

  it("turns JSON launches into secret-safe previews", () => {
    expect(parseArgs(["pi", "--json"])).toMatchObject({
      command: "launch",
      tool: "pi",
      inspect: true,
      output: "json"
    });
  });

  it("returns a useful error for an unknown tool", () => {
    expect(() => parseArgs(["cursor"])).toThrow('Unknown command "cursor"');
  });
});
