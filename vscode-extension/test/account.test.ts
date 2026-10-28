import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchAccountStatus, parseAccountStatus } from "../src/account.js";
import { STATUS_URL } from "../src/constants.js";

const VALID_ACCOUNT = {
  key: { id: "k_1", alias: "test" },
  billing: {
    status: "active",
    currency: "USD",
    plan: { id: "p1", name: "Pro", allowance: 100, used: 40, remaining: 60 },
    usagePacks: { total: 50, used: 10, remaining: 40 },
    totalRemaining: 60
  },
  activity30d: {
    requests: 120,
    modelRequests: 100,
    toolCalls: 20,
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cacheReadInputTokens: 300,
    spend: 12.5
  }
};

describe("parseAccountStatus", () => {
  it("parses a complete account status", () => {
    const result = parseAccountStatus(VALID_ACCOUNT);
    expect(result).not.toBeNull();
    expect(result?.billing.plan?.name).toBe("Pro");
    expect(result?.activity30d.cacheReadInputTokens).toBe(300);
  });

  it("accepts a null plan", () => {
    const noPlan = structuredClone(VALID_ACCOUNT);
    noPlan.billing.plan = null;
    expect(parseAccountStatus(noPlan)?.billing.plan).toBeNull();
  });

  it("rejects when required numeric fields are missing", () => {
    const bad = structuredClone(VALID_ACCOUNT);
    delete (bad as any).activity30d.spend;
    expect(parseAccountStatus(bad)).toBeNull();
  });

  it("rejects non-object inputs", () => {
    expect(parseAccountStatus(undefined)).toBeNull();
    expect(parseAccountStatus("nope")).toBeNull();
  });
});

describe("fetchAccountStatus", () => {
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

  it("returns available with the parsed account", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(VALID_ACCOUNT), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    const result = await fetchAccountStatus(apiKey);
    expect(result.state).toBe("available");
    if (result.state === "available") expect(result.account.key.id).toBe("k_1");
    expect(fetchMock).toHaveBeenCalledWith(STATUS_URL, expect.objectContaining({ headers: { Authorization: `Bearer ${apiKey}` } }));
  });

  it("returns rejected for 401/403", async () => {
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    expect(await fetchAccountStatus(apiKey)).toEqual({ state: "rejected" });
  });

  it("returns unavailable for other non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect(await fetchAccountStatus(apiKey)).toEqual({ state: "unavailable" });
  });

  it("returns unavailable on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await fetchAccountStatus(apiKey)).toEqual({ state: "unavailable" });
  });
});