import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_MODEL_CATALOG,
  CatalogAuthenticationError,
  loadModelCatalog,
  modelCatalogCachePath,
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

  it("uses bundled models when signed out with no cache", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-bundled-"));

    const catalog = await loadModelCatalog({ env: {}, homeDir });
    expect(catalog.source).toBe("bundled");
    expect(catalog.models).toEqual(BUNDLED_MODEL_CATALOG.models);
    expect(catalog.default).toBe(BUNDLED_MODEL_CATALOG.default);
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

  it("rejects malformed remote catalogs and falls back safely", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zro-catalog-invalid-"));
    const catalog = await loadModelCatalog({
      apiKey: "sk-secret",
      env: {},
      homeDir,
      fetch: async () => Response.json({ version: 1, default: "missing", models: [] }),
    });

    expect(catalog.source).toBe("bundled");
    expect(catalog.models).toEqual(BUNDLED_MODEL_CATALOG.models);
  });
});
