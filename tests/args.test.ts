import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("the direct command language", () => {
  it("offers login choices by default and keeps manual entry available", () => {
    expect(parseArgs(["login"])).toEqual({
      command: "login",
      apiKey: undefined,
      method: "choose",
      openBrowser: true,
      output: "human"
    });
    expect(parseArgs(["login", "--manual", "--no-browser"])).toMatchObject({
      command: "login",
      method: "manual",
      openBrowser: false
    });
  });

  it("does not keep the old authentication command aliases", () => {
    expect(() => parseArgs(["connect"])).toThrow('Unknown command "connect"');
    expect(() => parseArgs(["disconnect"])).toThrow('Unknown command "disconnect"');
  });

  it("launches a tool directly with a short model flag", () => {
    expect(parseArgs(["codex", "-m", "glm-5.2", "exec", "hello"])).toEqual({
      command: "launch",
      tool: "codex",
      model: "glm-5.2",
      apiKey: undefined,
      dryRun: false,
      output: "human",
      extraArgs: ["exec", "hello"]
    });
  });

  it("supports memorable tool aliases and dry runs", () => {
    expect(parseArgs(["oc", "--dry-run"])).toMatchObject({
      command: "launch",
      tool: "opencode",
      dryRun: true
    });
    expect(parseArgs(["kc", "--dry-run"])).toMatchObject({
      command: "launch",
      tool: "kilo",
      dryRun: true
    });
    expect(parseArgs(["kilocode", "--", "--help"])).toMatchObject({
      command: "launch",
      tool: "kilo",
      extraArgs: ["--help"]
    });
    expect(parseArgs(["oh-my-pi", "--", "models", "zro"])).toMatchObject({
      command: "launch",
      tool: "omp",
      extraArgs: ["models", "zro"]
    });
    expect(parseArgs(["ohmypi", "--dry-run"])).toMatchObject({
      command: "launch",
      tool: "omp",
      dryRun: true
    });
  });

  it("keeps the old launch shape as a migration path", () => {
    expect(parseArgs(["launch", "claude", "--", "--debug"])).toMatchObject({
      command: "launch",
      tool: "claude",
      extraArgs: ["--debug"]
    });
  });

  it("rejects the removed preview flags before the passthrough separator", () => {
    expect(() => parseArgs(["launch", "claude", "--inspect"])).toThrow("Use --dry-run");
    expect(() => parseArgs(["launch", "claude", "--print"])).toThrow("Use --dry-run");
    expect(parseArgs(["launch", "claude", "--", "--print"])).toMatchObject({
      command: "launch",
      tool: "claude",
      dryRun: false,
      extraArgs: ["--print"]
    });
  });

  it("parses install, upgrade, and pinned harness versions", () => {
    expect(parseArgs(["install", "claude@2.1.105"])).toEqual({
      command: "install",
      tool: "claude",
      upgrade: false,
      version: "2.1.105"
    });
    expect(parseArgs(["install", "--upgrade"])).toEqual({
      command: "install",
      tool: undefined,
      upgrade: true,
      version: undefined
    });
    expect(parseArgs(["claude", "--install"])).toMatchObject({
      command: "launch",
      tool: "claude",
      install: true
    });
    expect(() => parseArgs(["install", "claude@2.1.105", "--upgrade"]))
      .toThrow("either a pinned version or --upgrade");
  });

  it("turns JSON launches into secret-safe previews", () => {
    expect(parseArgs(["pi", "--json"])).toMatchObject({
      command: "launch",
      tool: "pi",
      dryRun: true,
      output: "json"
    });
  });

  it("returns a useful error for an unknown tool", () => {
    expect(() => parseArgs(["cursor"])).toThrow('Unknown command "cursor"');
  });

  it("parses feedback with an optional message and JSON output", () => {
    expect(parseArgs(["feedback", "it is great"])).toEqual({
      command: "feedback",
      message: "it is great",
      output: "human",
    });
    expect(parseArgs(["feedback"])).toEqual({
      command: "feedback",
      message: undefined,
      output: "human",
    });
    expect(parseArgs(["feedback", "--json"])).toEqual({
      command: "feedback",
      message: undefined,
      output: "json",
    });
  });
});
