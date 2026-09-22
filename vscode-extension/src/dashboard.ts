import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { fetchModelCatalog, type CatalogResult } from "./catalog.js";
import { fetchAccountStatus, type AccountStatusResult } from "./account.js";
import { resolveCredential, storeApiKey, deleteApiKey, maskKey, type CredentialSource } from "./credentials.js";
import { AuthFlowController } from "./auth.js";
import { setEffort, resolveEffort, readEffortSettings } from "./reasoning.js";
import { pricingLabel } from "./pricing.js";
import { EFFORT_DEFAULT, ENDPOINT_ROOT, type ZroModel } from "./constants.js";
/**
 * Dashboard webview with tabs: Overview, Models, Cost, Endpoints, Cache, Team.
 * Rendered both as a floating editor-area panel (`ZroDashboard`) and as a
 * docked sidebar view (`ZroDashboardViewProvider`). The shared controller logic
 * lives in `ZroDashboardController`. Backend surfaces mirror the control-plane
 * `/api/cli/*` Bearer endpoints (models + status). Features with no web
 * control-plane API yet (endpoint lifecycle, prompt-cache flush, team
 * management) show live read-only state plus a clear "not available" notice
 * rather than faking write access.
 */

const VIEW_TYPE = "zro.dashboard";
const MODEL_SELECT_KEY = "zro.selectedModel";

/**
 * Shared controller: data fetching, message handling, device-code login, and the
 * 60-second auto-refresh. Subclasses supply the backing `webview` and wire
 * `onDidReceiveMessage`/`onDidDispose` to the panel or view lifecycle.
 */
abstract class ZroDashboardController {
  private flowController: AuthFlowController | undefined;
  private flowTimer: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  protected constructor(
    protected readonly context: vscode.ExtensionContext,
    protected readonly subscriptions: vscode.Disposable[]
  ) {}

  /** The webview this controller posts to and listens on. */
  protected abstract get webview(): vscode.Webview;

  async refresh(): Promise<void> {
    await this.initializeAndPush();
  }

  protected async initializeAndPush(): Promise<void> {
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
        effort: buildEffortState(catalog.models),
        pricing: buildPricingState(catalog.models),
      },
    });
  }

  // --- Webview message handling ----------------------------------------------

  protected async handleMessage(message: Record<string, unknown>): Promise<void> {
    const type = typeof message.type === "string" ? message.type : "";
    switch (type) {
      case "ready":
        // The webview is now alive and can receive messages. This is the safe
        // moment to push the initial data (the html is set async, so any earlier
        // post would have been dropped).
        void this.initializeAndPush();
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
      case "setEffort": {
        // `model` is a model id, or null/absent for the global default.
        const modelId = typeof message.model === "string" && message.model ? message.model : null;
        const level = typeof message.level === "string" ? message.level : "";
        if (!level) break;
        await setEffort(modelId, level);
        await this.refresh();
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

  protected bootstrapRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => {});
    }, 60_000);
  }

  protected post(message: unknown): void {
    void this.webview.postMessage(message);
  }

  // --- Device-code login ------------------------------------------------------

  protected async startLogin(deviceName: unknown): Promise<void> {
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

  protected cancelLogin(): void {
    this.stopLogin();
    this.post({ type: "loginSession", session: null });
  }

  private stopLogin(): void {
    if (this.flowTimer) clearTimeout(this.flowTimer);
    this.flowTimer = undefined;
    this.flowController = undefined;
  }

  /** Stop timers and clear login state. Called by subclasses on dispose. */
  protected disposeController(): void {
    this.cancelLogin();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }
}

/** Floating editor-area webview panel. */
export class ZroDashboard extends ZroDashboardController {
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
    // Initial data push is driven by the webview's `ready` message (handled
    // below) rather than here: the panel's html is set asynchronously in the
    // constructor, so posting now would race and the messages would be dropped
    // before the webview script can receive them, leaving the dashboard stuck
    // on "Loading…".
    if (startLogin) void dashboard.startLogin(undefined);
  }

  readonly panel: vscode.WebviewPanel;

  protected get webview(): vscode.Webview {
    return this.panel.webview;
  }

  private constructor(context: vscode.ExtensionContext, subscriptions: vscode.Disposable[]) {
    super(context, subscriptions);
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
    // Light/dark pair: the black mark vanishes on a dark title bar.
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "icon.png"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "zro-mark-white.svg"),
    };
    void renderHtml(this.panel.webview, context.extensionUri).then((html) => {
      this.panel.webview.html = html;
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message as Record<string, unknown>);
    }, undefined, subscriptions);

    this.panel.onDidDispose(() => {
      this.disposeController();
      if (ZroDashboard.current === this) ZroDashboard.current = undefined;
    });
  }
}

/**
 * Sidebar webview view, docked in the ZRO activity-bar container. Renders the
 * same dashboard HTML and shares the controller logic with the panel form.
 */
export class ZroDashboardViewProvider extends ZroDashboardController implements vscode.WebviewViewProvider {
  public static readonly viewType = "zro.dashboardView";

  private view: vscode.WebviewView | undefined;

  constructor(context: vscode.ExtensionContext, subscriptions: vscode.Disposable[]) {
    super(context, subscriptions);
  }

  protected get webview(): vscode.Webview {
    if (!this.view) throw new Error("ZroDashboardViewProvider resolved before view was set");
    return this.view.webview;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      enableCommandUris: true,
    };
    void renderHtml(webviewView.webview, this.context.extensionUri).then((html) => {
      webviewView.webview.html = html;
    });

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message as Record<string, unknown>);
    }, undefined, this.subscriptions);

    webviewView.onDidDispose(() => {
      this.disposeController();
      this.view = undefined;
    });
  }
}

// --- Helpers -----------------------------------------------------------------

function getSelectedModel(context: vscode.ExtensionContext, catalog: CatalogResult | null): string | null {
  if (!catalog) return null;
  const saved = context.globalState.get<string>(MODEL_SELECT_KEY);
  if (saved && catalog.models.some((m) => m.id === saved)) return saved;
  return catalog.default ?? catalog.models[0]?.id ?? null;
}

/** Reasoning-effort state pushed to the webview's Models tab. */
interface EffortState {
  /** Global setting (EFFORT_DEFAULT when unset). */
  global: string;
  /** Effort levels advertised across all models, with descriptions. */
  globalLevels: Array<{ id: string; description: string }>;
  /** Per-model view: effective level, its source, and the model's own levels. */
  models: Array<{
    id: string;
    effective: string;
    source: string;
    defaultLevel: string;
    override: string | null;
    levels: Array<{ id: string; description: string }>;
  }>;
}

function buildEffortState(models: readonly ZroModel[]): EffortState {
  const settings = readEffortSettings();
  const globalLevels = new Map<string, string>();
  for (const model of models) {
    for (const level of model.reasoning?.levels ?? []) {
      if (!globalLevels.has(level.id)) globalLevels.set(level.id, level.description);
    }
  }
  return {
    global: settings.global,
    globalLevels: [...globalLevels.entries()].map(([id, description]) => ({ id, description })),
    models: models
      .filter((model) => (model.reasoning?.levels.length ?? 0) > 0)
      .map((model) => {
        const effective = resolveEffort(model.id, model.reasoning, settings);
        return {
          id: model.id,
          effective: effective.level ?? model.reasoning?.defaultLevel ?? EFFORT_DEFAULT,
          source: effective.source,
          defaultLevel: model.reasoning?.defaultLevel ?? EFFORT_DEFAULT,
          override: settings.perModel[model.id] ?? null,
          levels: (model.reasoning?.levels ?? []).map((level) => ({
            id: level.id,
            description: level.description,
          })),
        };
      }),
  };
}

/**
 * Model id → display price for the webview's Models tab. The webview cannot
 * import the pricing helpers, so the label is formatted here by the same
 * function the Copilot picker uses — one formatter, two surfaces.
 */
function buildPricingState(models: readonly ZroModel[]): Record<string, string> {
  const pricing: Record<string, string> = {};
  for (const model of models) {
    if (model.pricing) pricing[model.id] = pricingLabel(model.pricing);
  }
  return pricing;
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
  const iconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icon.png")
  );
  // The dashboard renders on a dark background, so its header uses the white
  // mark. media/icon.png is the black mark and is invisible there; it is kept
  // for light surfaces (Marketplace listing, light-theme editor tab icon).
  const markUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "zro-mark-white.svg")
  );
  const accountUrl = `${ENDPOINT_ROOT.replace(/\/+$/, "")}/account`;
  return html
    .replace(/\{\{cspSource\}\}/g, cspSource)
    .replace(/\{\{nonce\}\}/g, nonce)
    .replace(/\{\{iconUri\}\}/g, iconUri.toString())
    .replace(/\{\{markUri\}\}/g, markUri.toString())
    .replace(/\{\{accountUrl\}\}/g, accountUrl);
}
