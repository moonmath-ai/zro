import * as vscode from "vscode";
import { ZroModelProvider } from "./provider.js";
import { deleteApiKey, maskKey, resolveApiKey, storeApiKey } from "./credentials.js";
import { ZRO_ENV_KEY } from "./constants.js";
import { fetchModelCatalog } from "./catalog.js";
import { promptForEffort } from "./reasoning.js";
import { configureInExtensions } from "./extensions.js";
import { ZroDashboard, ZroDashboardViewProvider } from "./dashboard.js";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ZroModelProvider(context);
  const disposable = vscode.lm.registerLanguageModelChatProvider("zro", provider);
  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ZroDashboardViewProvider.viewType,
      new ZroDashboardViewProvider(context, context.subscriptions)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zro.manage", () => promptForApiKey(context)),
    vscode.commands.registerCommand("zro.setReasoningEffort", () => setReasoningEffort(context)),
    vscode.commands.registerCommand("zro.login", () => {
      ZroDashboard.show(context, context.subscriptions, true);
    }),
    vscode.commands.registerCommand("zro.dashboard", () => {
      ZroDashboard.show(context, context.subscriptions);
    }),
    vscode.commands.registerCommand("zro.configureExtensions", () =>
      configureInExtensions(context)
    )
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables in context.subscriptions.
}

/**
 * Interactive reasoning-effort picker. Fetches the live catalog so the level
 * choices come from the models' advertised reasoning blocks, then writes
 * `zro.reasoningEffort` / `zro.reasoningEffortByModel` for the next request.
 */
async function setReasoningEffort(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await resolveApiKey(context);
  if (!apiKey) {
    const pick = "[ZRO: Enter API key]";
    vscode.window.showInformationMessage(
      "Set an API key first so the model catalog (with reasoning levels) can be fetched.",
      pick
    ).then((chosen) => {
      if (chosen === pick) void vscode.commands.executeCommand("zro.manage");
    });
    return;
  }
  const { models } = await fetchModelCatalog(apiKey);
  await promptForEffort(models);
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const envValue = process.env[ZRO_ENV_KEY];
  if (envValue) {
    const clear = await vscode.window.showInformationMessage(
      `${ZRO_ENV_KEY} is set in the environment (${maskKey(envValue)}). Clear the stored key instead?`,
      "Keep env key",
      "Clear stored key"
    );
    if (clear === "Clear stored key") {
      await deleteApiKey(context);
      vscode.window.showInformationMessage("Removed the stored ZRO key from VS Code. The env var is still set.");
    }
    return;
  }

  const existing = await resolveApiKey(context);
  const placeholder = existing ? `Current key: ${maskKey(existing)}` : "Paste your ZRO API key (sk-…)";
  const entered = await vscode.window.showInputBox({
    prompt: "Enter your ZRO API key",
    placeHolder: placeholder,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : "API key cannot be empty.")
  });

  if (entered) {
    await storeApiKey(context, entered.trim());
    vscode.window.showInformationMessage("ZRO API key stored. ZRO models will appear in the Copilot Chat model picker.");
  }
}
