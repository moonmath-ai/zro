import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AuthFlowController } from "../src/auth.js";
import { getAuthRoot } from "../src/constants.js";

describe("device-code auth flow", () => {
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

  it("returns null when the auth start endpoint is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await AuthFlowController.start("VS Code")).toBeNull();
  });

  it("returns null when start is not ok or payload is invalid", async () => {
    fetchMock.mockResolvedValue(new Response("bad", { status: 500 }));
    expect(await AuthFlowController.start("VS Code")).toBeNull();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ deviceCode: "no-user-code" }), { status: 200 }));
    expect(await AuthFlowController.start("VS Code")).toBeNull();
  });

  it("creates a session with the approval URL and polling interval", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          deviceCode: "d123",
          userCode: "ABCD-EFGH",
          verificationUri: "https://zro.moonmath.ai/cli/authorize",
          verificationUriComplete: "https://zro.moonmath.ai/cli/approve?code=ABCD-EFGH",
          expiresIn: 600,
          interval: 2
        }),
        { status: 200 }
      )
    );
    const controller = await AuthFlowController.start("VS Code");
    expect(controller).not.toBeNull();
    expect(controller!.session.userCode).toBe("ABCD-EFGH");
    expect(controller!.session.intervalMs).toBe(2000);
    expect(controller!.session.approvalUrl).toContain("ABCD-EFGH");
    expect(controller!.session.deviceName).toBe("VS Code");
  });

  it("polls: returns pending on 202", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/auth/start")) return validStartResponse();
      return new Response(JSON.stringify({ status: "pending" }), { status: 202 });
    });
    const controller = await AuthFlowController.start("VS Code");
    const result = await controller!.poll();
    expect(result.state).toBe("pending");
    expect(fetchMock).toHaveBeenCalledWith(
      `${getAuthRoot()}/api/cli/auth/token`,
      expect.objectContaining({ body: JSON.stringify({ deviceCode: "d123" }) })
    );
  });

  it("polls expired on 410", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/auth/start")) return validStartResponse();
      return new Response("expired", { status: 410 });
    });
    const controller = await AuthFlowController.start("VS Code");
    expect((await controller!.poll()).state).toBe("expired");
  });

  it("returns failed when the token response is not ok", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/auth/start")) return validStartResponse();
      return new Response("boom", { status: 500 });
    });
    const controller = await AuthFlowController.start("VS Code");
    const result = await controller!.poll();
    expect(result.state).toBe("failed");
  });

  it("decrypts and returns the approved api key", async () => {
    // Capture the client's generated public key from the /start request so we
    // can encrypt a token the client will be able to decrypt.
    let clientPublicKey = "";
    fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.endsWith("/auth/start")) {
        const body = JSON.parse(init?.body ?? "{}") as { publicKey: string };
        clientPublicKey = body.publicKey;
        return new Response(
          JSON.stringify({
            deviceCode: "d123",
            userCode: "AB-CD",
            verificationUriComplete: "https://zroku.geometry/approve?code=AB-CD",
            expiresIn: 600,
            interval: 2
          }),
          { status: 200 }
        );
      }
      const { publicEncrypt, constants } = (await import("node:crypto"));
      const encrypted = publicEncrypt(
        { key: clientPublicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        Buffer.from("sk-secret-token", "utf8")
      ).toString("base64");
      return new Response(JSON.stringify({ encryptedToken: encrypted }), { status: 200 });
    });

    const controller = await AuthFlowController.start("VS Code");
    const result = await controller!.poll();
    expect(result.state).toBe("approved");
    if (result.state === "approved") expect(result.apiKey).toBe("sk-secret-token");
  });
});

function validStartResponse(): Response {
  return new Response(
    JSON.stringify({
      deviceCode: "d123",
      userCode: "AB-CD",
      verificationUriComplete: "https://zroku.moonmath.ai/approve?code=AB-CD",
      expiresIn: 600,
      interval: 2
    }),
    { status: 200 }
  );
}