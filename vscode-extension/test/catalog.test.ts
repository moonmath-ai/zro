import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchModelCatalog } from "../src/catalog.js";
import { CATALOG_URL } from "../src/constants.js";

describe("fetchModelCatalog", () => {
  const apiKey = "sk-test";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error - test harness replaces global fetch
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error - clean up the stub
    delete globalThis.fetch;
  });

  it("maps remote models into ZroModel entries", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          default: "glm-5.2",
          models: [
            { id: "glm-5.2", displayName: "GLM-5.2", contextWindow: 524288, maxOutputTokens: 64000 },
            { id: "kimi-k3", displayName: "Kimi K3", contextWindow: 1048576, maxOutputTokens: 64000 }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { default: defaultId, models } = await fetchModelCatalog(apiKey);

    expect(defaultId).toBe("glm-5.2");
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      id: "glm-5.2",
      displayName: "GLM-5.2",
      contextWindow: 524288,
      maxOutputTokens: 64000
    });
    expect(fetchMock).toHaveBeenCalledWith(
      CATALOG_URL,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${apiKey}` }
      })
    );
  });

  it("sends the bearer token from the provided api key", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await fetchModelCatalog(apiKey);
    expect(fetchMock).toHaveBeenCalledWith(
      CATALOG_URL,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${apiKey}` }
      })
    );
  });

  it("falls back to the static catalog when the endpoint errors", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const { default: defaultId, models } = await fetchModelCatalog(apiKey);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeTruthy();
    expect(defaultId).toBe(models[0].id);
  });

  it("applies defaults for missing catalog fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ id: "model-x", displayName: "Model X" }]
        }),
        { status: 200 }
      )
    );
    const { models } = await fetchModelCatalog(apiKey);
    expect(models[0]).toEqual({
      id: "model-x",
      displayName: "Model X",
      contextWindow: 128_000,
      maxOutputTokens: 64_000
    });
  });

  it("falls back when models array is empty", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ default: "x", models: [] }), { status: 200 })
    );
    const { models } = await fetchModelCatalog(apiKey);
    expect(models.length).toBeGreaterThan(0);
  });
});