import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  credentialFilePath,
  deleteStoredApiKey,
  maskKey,
  readStoredApiKey,
  redactSecrets,
  resolveApiKey,
  writeStoredApiKey
} from "../src/engine/key.js";

describe("key handling", () => {
  it("uses the explicit flag before the environment", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-key-"));
    await expect(resolveApiKey({
      flagValue: "sk-from-flag",
      env: { ZRO_API_KEY: "sk-from-env" },
      homeDir
    })).resolves.toEqual({ apiKey: "sk-from-flag", source: "flag" });
  });

  it("uses the environment before stored credentials", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-key-"));
    await writeStoredApiKey({ apiKey: "sk-stored", env: {}, homeDir });
    await expect(resolveApiKey({
      env: { ZRO_API_KEY: "sk-from-env" },
      homeDir
    })).resolves.toEqual({ apiKey: "sk-from-env", source: "env" });
  });

  it("stores credentials with user-only permissions", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-key-store-"));
    const env = {};
    const filePath = await writeStoredApiKey({ apiKey: "sk-stored-secret", homeDir, env });

    expect(filePath).toBe(credentialFilePath({ homeDir, env }));
    expect(await readStoredApiKey({ homeDir, env })).toBe("sk-stored-secret");
    if (process.platform !== "win32") {
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    }
    expect(await deleteStoredApiKey({ homeDir, env })).toBe(true);
    expect(await readStoredApiKey({ homeDir, env })).toBeNull();
  });

  it("masks credentials in diagnostic text", () => {
    expect(maskKey("sk-test-secret")).toBe("sk-****...cret");
    expect(redactSecrets("apiKey: sk-test-secret", ["sk-test-secret"]))
      .toBe("apiKey: sk-****...cret");
  });
});
