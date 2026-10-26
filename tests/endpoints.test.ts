import { describe, expect, it } from "vitest";
import { normalizeInferenceRoot, resolveInference } from "../src/endpoints.js";

describe("inference endpoints", () => {
  it("accepts a root or a URL ending in /v1 and drops trailing slashes", () => {
    expect(normalizeInferenceRoot("https://gateway.example/")).toBe("https://gateway.example");
    expect(normalizeInferenceRoot("https://gateway.example/v1")).toBe("https://gateway.example");
    expect(normalizeInferenceRoot("https://gateway.example/v1/")).toBe("https://gateway.example");
    expect(normalizeInferenceRoot("http://localhost:8080/v1")).toBe("http://localhost:8080");
    expect(normalizeInferenceRoot("https://gateway.example/prefix/v1/")).toBe("https://gateway.example/prefix");
  });

  it("rejects invalid, non-http, or non-root URLs", () => {
    expect(() => normalizeInferenceRoot("not a url")).toThrow("Invalid inference URL");
    expect(() => normalizeInferenceRoot("ftp://gateway.example")).toThrow("Use an http(s) URL");
    expect(() => normalizeInferenceRoot("https://gateway.example/v1?key=value")).toThrow("Remove the query string");
    expect(() => normalizeInferenceRoot("https://gateway.example/v1#hash")).toThrow("Remove the query string");
  });

  it("resolves the inference root by flag, env, endpoint root, then default", () => {
    const env = {
      ZRO_INFERENCE_URL: "https://env.example/v1/",
      ZRO_ENDPOINT_ROOT: "https://endpoint.example",
    };
    expect(resolveInference(env, "https://flag.example/v1").root).toBe("https://flag.example");
    expect(resolveInference(env).root).toBe("https://env.example");
    expect(resolveInference({ ZRO_ENDPOINT_ROOT: "https://endpoint.example" }).root)
      .toBe("https://endpoint.example");
    expect(resolveInference({}).root).toBe("https://zro.moonmath.ai");
    expect(resolveInference(env, "https://flag.example").baseUrl).toBe("https://flag.example/v1");
  });

  it("requires an explicit override in no-auth mode", () => {
    expect(() => resolveInference({ ZRO_ENDPOINT_ROOT: "https://endpoint.example" }, undefined, true))
      .toThrow("No-auth mode needs an inference URL");
    expect(resolveInference({ ZRO_INFERENCE_URL: "https://env.example" }, undefined, true).root)
      .toBe("https://env.example");
    expect(resolveInference({}, "https://flag.example", true).root).toBe("https://flag.example");
  });
});
