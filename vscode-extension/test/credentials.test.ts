import { describe, it, expect } from "vitest";
import { maskKey } from "../src/credentials.js";

describe("maskKey", () => {
  it("masks sk- prefixed keys", () => {
    expect(maskKey("sk-abcdefghijkl")).toBe("sk-****...ijkl");
  });

  it("masks long non-sk keys keeping first 3 and last 4 chars", () => {
    const masked = maskKey("abcdefghijklmnop");
    expect(masked).toBe("abc****...mnop");
    // Never leaks the middle.
    expect(masked).not.toContain("defghijkl");
  });

  it("does not reveal the full key", () => {
    const full = "sk-super-secret-key-value-1234567890";
    expect(maskKey(full)).not.toContain("super-secret");
  });

  it("returns a placeholder for empty input", () => {
    expect(maskKey("")).toBe("****");
  });

  it("handles short keys without a suffix", () => {
    const masked = maskKey("abc");
    expect(masked).toBe("abc****");
  });
});