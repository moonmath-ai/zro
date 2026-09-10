import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CatalogAuthenticationError,
  loadModelCatalog,
  modelCatalogCachePath,
  parsePublicCatalog,
} from "../src/model-catalog.js";

const dynamicCatalog = {
  version: 1,
  default: "future-model",
  models: [
    {
      id: "future-model",
      displayName: "Future Model",
      contextWindow: 200_000,
      maxOutputTokens: 20_000,
      modalities: { input: ["text"], output: ["text"] },
      reasoning: {
        defaultLevel: "high",
        levels: [
          {
            id: "high",
            description: "Reason carefully",
            piLevel: "high",
            openCodeOptions: { reasoningEffort: "high" },
          },
        ],
      },
    },
  ],
};

const publicCatalog = {
  data: [
    {
      id: "public-model",
      name: "Public Model",
      context_length: 200_000,
      max_output_length: 20_000,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      supported_features: ["tools", "reasoning"],
    },
  ],
};

describe("dynamic model catalog", () => {
  it("fetches an authenticated catalog and caches it", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-"));
    const env = { ZRO_AUTH_URL: "https://auth.zro.example" };
    const catalog = await loadModelCatalog({
      apiKey: "sk-secret",
      env,
      homeDir,
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://auth.zro.example/api/cli/models");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-secret");
        return Response.json(dynamicCatalog);
      },
    });

    expect(catalog.default).toBe("future-model");
    expect(catalog.models[0].displayName).toBe("Future Model");
    expect(JSON.parse(await fs.readFile(
      modelCatalogCachePath({ env, homeDir }),
      "utf8",
    ))).toEqual(dynamicCatalog);
  });

  it("uses the cached catalog when the control plane is unavailable", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-cache-"));
    const env = {};
    const cachePath = modelCatalogCachePath({ env, homeDir });
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(dynamicCatalog));

    const catalog = await loadModelCatalog({
      apiKey: "sk-secret",
      env,
      homeDir,
      fetch: async () => new Response(null, { status: 503 }),
    });

    expect(catalog.default).toBe("future-model");
  });

  it("fetches the public catalog when signed out with no cache", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-public-"));
    const catalog = await loadModelCatalog({
      env: {},
      homeDir,
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://zro.moonmath.ai/models");
        expect(init?.headers).toBeUndefined();
        return Response.json(publicCatalog);
      },
    });

    expect(catalog.default).toBe("public-model");
    expect(catalog.models[0].modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    expect(catalog.models[0].reasoning.levels.map((level) => level.id)).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
  });

  it("does not cache the public fallback when a key was supplied", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-nocache-"));
    await loadModelCatalog({
      apiKey: "sk-secret",
      env: {},
      homeDir,
      fetch: async (input) => String(input).endsWith("/api/cli/models")
        ? new Response(null, { status: 503 })
        : Response.json(publicCatalog),
    });

    await expect(fs.stat(modelCatalogCachePath({ env: {}, homeDir })))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never hides an explicit authentication rejection behind a cache", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-auth-"));
    const cachePath = modelCatalogCachePath({ env: {}, homeDir });
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(dynamicCatalog));

    await expect(loadModelCatalog({
      apiKey: "sk-rejected",
      env: {},
      homeDir,
      fetch: async () => new Response(null, { status: 401 }),
    })).rejects.toBeInstanceOf(CatalogAuthenticationError);
    await expect(fs.stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a malformed public catalog", async () => {
    await expect(loadModelCatalog({
      env: {},
      homeDir: await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-invalid-")),
      fetch: async () => Response.json({ version: 1, data: [] }),
    })).rejects.toThrow("empty");
  });
});

describe("public catalog parsing", () => {
  it("rejects an empty catalog", () => {
    expect(() => parsePublicCatalog({ data: [] })).toThrow("empty");
  });
});