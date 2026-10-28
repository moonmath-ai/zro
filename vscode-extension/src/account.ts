import { STATUS_URL } from "./constants.js";

/**
 * Cost / usage / plan payload returned by the control plane's `/api/cli/status`
 * endpoint. Field names mirror `zro/src/run.ts::AccountStatus`.
 */
export interface AccountStatus {
  key: { id: string; alias: string };
  billing: {
    status: string;
    currency: string;
    plan: {
      id: string;
      name: string;
      allowance: number;
      used: number;
      remaining: number;
    } | null;
    usagePacks: { total: number; used: number; remaining: number };
    totalRemaining: number;
  };
  activity30d: {
    requests: number;
    modelRequests: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens: number;
    spend: number;
  };
}

export type AccountStatusResult =
  | { state: "available"; account: AccountStatus }
  | { state: "rejected" }
  | { state: "unavailable" };

/**
 * Fetch the account/cost/usage dashboard for the given API key. Returns a
 * discriminated result so the UI can distinguish "bad key" from "network/5xx".
 */
export async function fetchAccountStatus(
  apiKey: string,
  signal?: AbortSignal
): Promise<AccountStatusResult> {
  try {
    const response = await fetch(STATUS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ?? AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      return { state: "rejected" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { state: "unavailable" };
    }
    const account = parseAccountStatus(await response.json());
    return account ? { state: "available", account } : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function hasNumbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

export function parseAccountStatus(value: unknown): AccountStatus | null {
  const root = asRecord(value);
  const key = asRecord(root.key);
  const billing = asRecord(root.billing);
  const packs = asRecord(billing.usagePacks);
  const activity = asRecord(root.activity30d);
  const planValue = billing.plan;
  const plan = planValue === null ? null : asRecord(planValue);
  if (
    typeof key.id !== "string" ||
    typeof key.alias !== "string" ||
    typeof billing.status !== "string" ||
    typeof billing.currency !== "string" ||
    !hasNumbers(packs, ["total", "used", "remaining"]) ||
    !hasNumbers(billing, ["totalRemaining"]) ||
    !hasNumbers(activity, [
      "requests",
      "modelRequests",
      "toolCalls",
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "cacheReadInputTokens",
      "spend",
    ]) ||
    (plan !== null &&
      (typeof plan.id !== "string" ||
        typeof plan.name !== "string" ||
        !hasNumbers(plan, ["allowance", "used", "remaining"])))
  ) {
    return null;
  }

  return value as AccountStatus;
}