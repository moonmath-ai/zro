import {
  generateKeyPairSync,
  privateDecrypt,
  constants as cryptoConstants,
} from "node:crypto";
import { browserApprovalUrl, getAuthRoot } from "./constants.js";

/**
 * Device-authorization OAuth login flow against the ZRO control plane.
 * Mirrors `zro/src/run.ts::loginWithWebsite`: generate an RSA keypair, POST the
 * public key to `/api/cli/auth/start`, show the user a code + approval URL,
 * poll `/api/cli/auth/token`, then decrypt the returned (RSA-OAEP-256)
 * encrypted API key with our private key.
 *
 * The private key must live in the extension host (not the webview), so the
 * flow is driven through an {@link AuthFlowController}.
 */

interface DeviceLoginStart {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface AuthSession {
  /** Human-readable code the user must approve on the website (e.g. `ABCD-EFGH`). */
  userCode: string;
  /** Complete approval URL to open in the browser. */
  approvalUrl: string;
  /** ISO timestamp when the device code expires. */
  expiresAt: string;
  /** Poll interval in milliseconds. */
  intervalMs: number;
  /** Device name sent to the server. */
  deviceName: string;
}

export type LoginPollResult =
  | { state: "pending" }
  | { state: "approved"; apiKey: string }
  | { state: "expired" }
  | { state: "failed"; detail: string };

/**
 * Holds the state for one device-code login attempt: the public/private keypair
 * and the device code required to poll the token endpoint.
 */
export class AuthFlowController {
  private readonly privateKey: string;
  private readonly deviceCode: string;

  private constructor(session: AuthSession, privateKey: string, deviceCode: string) {
    this.privateKey = privateKey;
    this.deviceCode = deviceCode;
    this.session = session;
  }

  /** Session details safe to send to the webview for display. */
  readonly session: AuthSession;

  /**
   * Start a new device-code login. Returns a controller, or `null` if the auth
   * endpoint is unreachable.
   */
  static async start(deviceName: string): Promise<AuthFlowController | null> {
    const authRoot = getAuthRoot();
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    try {
      const response = await fetch(`${authRoot}/api/cli/auth/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, deviceName }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const started = parseStart(await response.json());
      if (!started) return null;

      const session: AuthSession = {
        userCode: started.userCode,
        approvalUrl: browserApprovalUrl(started.verificationUriComplete),
        expiresAt: new Date(Date.now() + started.expiresIn * 1000).toISOString(),
        intervalMs: Math.max(1, started.interval) * 1000,
        deviceName,
      };
      return new AuthFlowController(session, privateKey, started.deviceCode);
    } catch {
      return null;
    }
  }

  /** Poll the token endpoint once. */
  async poll(): Promise<LoginPollResult> {
    const authRoot = getAuthRoot();
    let response: Response;
    try {
      response = await fetch(`${authRoot}/api/cli/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: this.deviceCode }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { state: "failed", detail: "Could not reach the auth endpoint." };
    }

    if (response.status === 202) return { state: "pending" };
    if (response.status === 410) return { state: "expired" };
    if (!response.ok) return { state: "failed", detail: `Auth failed (HTTP ${response.status}).` };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { state: "failed", detail: "The server returned an invalid response." };
    }

    const encryptedToken = asRecord(payload).encryptedToken;
    if (typeof encryptedToken !== "string" || !encryptedToken) {
      return { state: "failed", detail: "The server returned an invalid credential." };
    }

    try {
      const apiKey = privateDecrypt(
        {
          key: this.privateKey,
          padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(encryptedToken, "base64")
      ).toString("utf8");
      if (!apiKey.trim()) return { state: "failed", detail: "Empty credential returned." };
      return { state: "approved", apiKey: apiKey.trim() };
    } catch {
      return { state: "failed", detail: "Could not decrypt the credential." };
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function parseStart(value: unknown): DeviceLoginStart | null {
  const root = asRecord(value);
  if (
    typeof root.deviceCode !== "string" ||
    typeof root.userCode !== "string" ||
    typeof root.verificationUriComplete !== "string" ||
    typeof root.expiresIn !== "number" ||
    typeof root.interval !== "number"
  ) {
    return null;
  }
  return {
    deviceCode: root.deviceCode,
    userCode: root.userCode,
    verificationUriComplete: root.verificationUriComplete,
    expiresIn: root.expiresIn,
    interval: root.interval,
  };
}