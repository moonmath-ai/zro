import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandExists } from "../src/install.js";

describe("Windows support", () => {
  it("finds command shims using PATHEXT", async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "zro-win-bin-"));
    await fs.writeFile(path.join(bin, "codex.CMD"), "@echo off\r\n");

    await expect(commandExists("codex", {
      PATH: bin,
      PATHEXT: ".EXE;.CMD",
    }, "win32")).resolves.toBe(true);
  });
});
