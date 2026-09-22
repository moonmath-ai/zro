import { describe, expect, it } from "vitest";
import { redact } from "../src/run.js";

const SECRET = "sk-live-secret-0001";

describe("redact", () => {
  it("masks env names whose secret-bearing segment matches, in any casing", () => {
    for (const key of [
      "ZRO_API_KEY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ZRO_MCP_AUTHORIZATION",
      "OPENCODE_API_KEY",
      "OPENCLAW_CREDENTIALS",
      "SOME_PASSWORD",
      "api_key",
      "ApiKey",
      "apiKey"
    ]) {
      const masked = redact(key, "harmless-value-that-is-not-the-secret", SECRET);
      expect(masked, key).toMatch(/\*\*\*\*/);
      expect(masked, key).not.toContain("harmless-value");
    }
  });

  it("masks any value that contains the secret, whatever the name", () => {
    expect(redact("CLAUDE_CODE_MCP_URL", `Bearer ${SECRET}`, SECRET)).toMatch(/\*\*\*\*/);
  });

  it("does not mask token-count names that are not secrets", () => {
    expect(redact("CLAUDE_CODE_MAX_CONTEXT_TOKENS", "1048576", SECRET)).toBe("1048576");
    expect(redact("CONTEXT_TOKENS", "1048576", SECRET)).toBe("1048576");
  });

  it("masks a secret under a key-shaped name even when the value differs from the selected key", () => {
    const masked = redact("OTHER_SERVICE_API_KEY", "different-plain-value", SECRET);
    expect(masked).toMatch(/\*\*\*\*/);
    expect(masked).not.toContain("different-plain-value");
  });
});
