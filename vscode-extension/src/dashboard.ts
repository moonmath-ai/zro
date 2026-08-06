import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { fetchModelCatalog, type CatalogResult } from "./catalog.js";
import { fetchAccountStatus, type AccountStatusResult } from "./account.js";
import { resolveCredential, storeApiKey, deleteApiKey, maskKey, type CredentialSource } from "./credentials.js";
import { AuthFlowController } from "./auth.js";

/**
 * Single-panel dashboard webview with tabs: Overview, Models, Cost, Endpoints,
 * Cache, Team. Backend surfaces mirror the control-plane `/api/cli/*` Bearer
 * endpoints (models + status). Features with no web control-plane API yet
 * (endpoint lifecycle, prompt-cache flush, team management) show live read-only
 * state plus a clear "not available" notice rather than faking write access.
 */

const VIEW_TYPE = "zro.dashboard";
const MODEL_SELECT_KEY = "zro.selectedModel";

export class ZroDashboard {
  private static current: ZroDashboard | undefined;

  /** Show (or focus + refresh) the dashboard panel. Optionally start browser login. */
  static show(context: vscode.ExtensionContext, subscriptions: vscode.Disposable[], startLogin = false): void {
    if (ZroDashboard.current) {
      const existing = ZroDashboard.current;
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (startLogin) void existing.startLogin(undefined);
      else void existing.refresh();
      return;
    }
    const dashboard = new ZroDashboard(context, subscriptions);
    ZroDashboard.current = dashboard;
    void dashboard.initializeAndPush();
    if (startLogin) void dashboard.startLogin(undefined);
  }

  readonly panel: vscode.WebviewPanel;

  private flowController: AuthFlowController | undefined;
  private flowTimer: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    subscriptions: vscode.Disposable[]
  ) {
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "ZRO",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
        enableCommandUris: true,
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
    void renderHtml(this.panel.webview, context.extensionUri).then((html) => {
      this.panel.webview.html = html;
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message as Record<string, unknown>);
    }, undefined, subscriptions);

    this.panel.onDidDispose(() => {
      this.cancelLogin();
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
      if (ZroDashboard.current === this) ZroDashboard.current = undefined;
    });
  }

  async refresh(): Promise<void> {
    await this.initializeAndPush();
  }

  private async initializeAndPush(): Promise<void> {
    const { apiKey, source } = await resolveCredential(this.context);
    this.post({ type: "credentialState", payload: buildCredentialState(apiKey, source) });

    if (!apiKey) {
      this.post({ type: "data", payload: { keyless: true } });
      return;
    }

    const [catalog, account] = await Promise.all([
      fetchModelCatalog(apiKey),
      fetchAccountStatus(apiKey),
    ]);

    const selected = getSelectedModel(this.context, catalog);
    this.post({
      type: "data",
      payload: {
        keyless: false,
        catalog,
        account,
        selected,
      },
    });
  }

  // --- Webview message handling ----------------------------------------------

  private async handleMessage(message: Record<string, unknown>): Promise<void> {
    const type = typeof message.type === "string" ? message.type : "";
    switch (type) {
      case "ready":
        this.bootstrapRefresh();
        break;
      case "refresh":
        await this.refresh();
        break;
      case "selectModel": {
        if (typeof message.model === "string") {
          await this.context.globalState.update(MODEL_SELECT_KEY, message.model);
          await this.refresh();
        }
        break;
      }
      case "openChat": {
        await vscode.commands.executeCommand("workbench.action.chat.open");
        break;
      }
      case "login": {
        await this.startLogin(message.deviceName);
        break;
      }
      case "loginPoll":
        await this.pollLogin();
        break;
      case "loginCancel":
        this.cancelLogin();
        break;
      case "manualKey": {
        await vscode.commands.executeCommand("zro.manage");
        await this.refresh();
        break;
      }
      case "logout": {
        const confirm = await vscode.window.showWarningMessage(
          "Remove the stored ZRO API key?",
          { modal: true },
          "Log out"
        );
        if (confirm !== "Log out") break;
        await deleteApiKey(this.context);
        vscode.window.showInformationMessage("Removed the stored ZRO API key.");
        await this.refresh();
        break;
      }
      case "openBrowser": {
        if (typeof message.url === "string") {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      }
      case "clearCache":
        this.post({
          type: "notice",
          kind: "info",
          message:
            "Prompt-cache flushing is not available yet. Cache read usage shown here is live from the control plane.",
        });
        break;
      case "manageEndpoint":
        this.post({
          type: "notice",
          kind: "info",
          message:
            "Endpoint provisioning runs out-of-band on serving nodes (deploy-model.sh). The Endpoints tab reflects the live model catalog.",
        });
        break;
      default:
        break;
    }
  }

  private bootstrapRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => {});
    }, 60_000);
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  // --- Device-code login ------------------------------------------------------

  private async startLogin(deviceName: unknown): Promise<void> {
    if (this.flowController) {
      this.post({ type: "notice", kind: "warn", message: "A login is already in progress." });
      return;
    }
    const name = typeof deviceName === "string" && deviceName.trim() ? deviceName.trim() : "VS Code";
    const controller = await AuthFlowController.start(name);
    if (!controller) {
      this.post({ type: "loginSession", session: null });
      this.post({
        type: "notice",
        kind: "error",
        message: "Could not start browser sign-in (auth endpoint unreachable). Use manual API-key entry instead.",
      });
      return;
    }
    this.flowController = controller;
    this.post({ type: "loginSession", session: controller.session });
    await vscode.env.openExternal(vscode.Uri.parse(controller.session.approvalUrl));
    this.queuePoll(controller.session.intervalMs);
  }

  private queuePoll(intervalMs: number): void {
    if (this.flowTimer) clearTimeout(this.flowTimer);
    this.flowTimer = setTimeout(() => void this.pollLogin(), Math.max(1000, intervalMs));
  }

  private async pollLogin(): Promise<void> {
    const controller = this.flowController;
    if (!controller) return;
    const result = await controller.poll();
    if (result.state === "pending") {
      this.queuePoll(controller.session.intervalMs);
      return;
    }
    this.stopLogin();
    if (result.state === "approved") {
      await storeApiKey(this.context, result.apiKey);
      this.post({ type: "loginResult", result: { state: "approved" } });
      await this.refresh();
    } else {
      this.post({ type: "loginResult", result });
    }
  }

  private cancelLogin(): void {
    this.stopLogin();
    this.post({ type: "loginSession", session: null });
  }

  private stopLogin(): void {
    if (this.flowTimer) clearTimeout(this.flowTimer);
    this.flowTimer = undefined;
    this.flowController = undefined;
  }
}

// --- Helpers -----------------------------------------------------------------

function getSelectedModel(context: vscode.ExtensionContext, catalog: CatalogResult | null): string | null {
  if (!catalog) return null;
  const saved = context.globalState.get<string>(MODEL_SELECT_KEY);
  if (saved && catalog.models.some((m) => m.id === saved)) return saved;
  return catalog.default ?? catalog.models[0]?.id ?? null;
}

interface CredentialState {
  hasKey: boolean;
  keySource: CredentialSource;
  maskedKey: string | null;
}

function buildCredentialState(apiKey: string | undefined, source: CredentialSource): CredentialState {
  if (!apiKey) return { hasKey: false, keySource: "none", maskedKey: null };
  return { hasKey: true, keySource: source, maskedKey: maskKey(apiKey) };
}

async function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const htmlPath = path.join(extensionUri.fsPath, "media", "dashboard.html");
  let html: string;
  try {
    html = await fs.readFile(htmlPath, "utf8");
  } catch {
    return "<html><body><p>Dashboard template missing.</p></body></html>";
  }
  const cspSource = webview.cspSource;
  const nonce = Math.random().toString(36).slice(2);
  return html
    .replace(/\{\{cspSource\}\}/g, cspSource)
    .replace(/\{\{nonce\}\}/g, nonce);
}