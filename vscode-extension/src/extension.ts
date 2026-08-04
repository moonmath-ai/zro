import * as vscode from "vscode";
import { ZroModelProvider } from "./provider.js";
import { deleteApiKey, maskKey, resolveApiKey, storeApiKey } from "./credentials.js";
import { ZRO_ENV_KEY } from "./constants.js";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ZroModelProvider(context);
  const disposable = vscode.lm.registerLanguageModelChatProvider("zro", provider);
  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand("zro.manage", () => promptForApiKey(context)),
    vscode.commands.registerCommand("zro.login", () => promptForApiKey(context))
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables in context.subscriptions.
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
