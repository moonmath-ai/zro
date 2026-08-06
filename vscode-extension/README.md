# ZRO for VS Code

Use [ZRO](https://zro.moonmath.ai) models directly inside VS Code's Copilot Chat.

ZRO registers as a first-class language model provider, so its models show up
natively in the Copilot Chat model picker — no proxy, no separate window, no
copy-paste. Pick a model, chat as usual, and responses stream from the ZRO
inference endpoint with full tool-calling support (file edits, terminal, etc.).

## Features

- **Native model discovery** — ZRO models appear in the Copilot Chat dropdown,
  prefixed with `ZRO`. The catalog is fetched live from the control plane on
  every picker refresh, so newly activated models appear automatically — no
  extension update needed.
- **Dashboard panel** — run `ZRO: Dashboard` (or `ZRO: Sign in with browser`)
  from the Command Palette to open a single-panel dashboard with tabs for
  **Overview**, **Models**, **Cost**, **Endpoints**, **Cache**, and **Team**.
- **Browser sign-in (OAuth)** — start a device-authorization login right from
  VS Code, approve it in your browser, and the API key is stored securely in
  SecretStorage — no copying keys.
- **Cost &amp; usage dashboard** — plan allowance, usage packs, remaining credit,
  and trailing-30-day activity (tokens, requests, spend) fetched live from the
  control plane.
- **Prompt-cache visibility** — cache-read token usage is shown in the Cost and
  Cache tabs (cache *controls* are not exposed by the API yet).
- **Zero-config if you already use the CLI** — the extension reads the same
  `~/.config/zro/credentials.json` file written by `zro login`, so existing users
  are ready to go immediately after install.
- **Streaming + tool calls** — responses stream token-by-token, and tool calls
  round-trip through Copilot Chat's agent loop just like any built-in model.
- **Resilient fallback** — if the control plane is unreachable, a built-in model
  list keeps the picker populated so you're never left without options.

## Install

### From a .vsix

```bash
code --install-extension zro-0.1.0.vsix
```

Or in VS Code: Extensions → `…` → *Install from VSIX…*.

## Authenticate

Pick one — all three use the same credential resolution order:

1. **Sign in with browser** — run `ZRO: Sign in` (`zro.login`). VS Code starts a
   device flow, opens your browser, and stores the resulting key securely once
   you approve.
2. **Already logged in via the CLI** — run `zro login` once. The extension reads
   the same `~/.config/zro/credentials.json` file, so no further setup is needed.
3. **From VS Code** — run the `ZRO: Enter API key` command from the Command
   Palette and paste a ZRO API key. It is stored in VS Code's SecretStorage.
4. **For CI / power users** — set the `ZRO_API_KEY` environment variable. It
   takes precedence over the other two.

## Use

1. Open Copilot Chat (`⌘⇧I` / `Ctrl+Shift+I`).
2. Pick a model from the dropdown — ZRO models are prefixed with `ZRO`.
3. Chat as usual. Responses stream from the ZRO endpoint; tool calls (file edits,
   terminal, etc.) round-trip through Copilot Chat's agent loop.

That's it. Once authenticated, every ZRO model active in the control plane is
available with no additional configuration.

## Configuration

| Setting | Purpose | Default |
| --- | --- | --- |
| `ZRO_API_KEY` (env) | API key — overrides everything else | — |
| `ZRO_ENDPOINT_ROOT` (env) | Inference + catalog endpoint root | `https://zro.moonmath.ai` |

## Use with Cline, Continue, and Roo Code

ZRO also works inside other AI-coding extensions. Run the
**`ZRO: Configure in other extensions`** command — it detects which of
Cline, Continue, and Roo Code are installed and walks you through wiring
them up.

- **Cline** and **Roo Code** can use ZRO models with no second API key via
  their **"VS Code Language Model API"** provider, because ZRO already
  registers as a VS Code language model provider. The command opens the
  right settings screen and shows the exact steps. It also offers to
  generate an OpenAI-compatible profile (base URL + API key + model ID)
  for users who prefer that provider type.
- **Continue** is configured by merging ZRO model entries into
  `~/.continue/config.yaml` (or `config.json`), replacing any previous
  `ZRO ` entries. Your API key is written to that file in plaintext, so
  the command asks for confirmation first.

## Notes

- The model catalog is fetched live from the control plane's `/api/cli/models`
  endpoint on every picker refresh, filtered to the models currently active in
  LiteLLM. If that fetch fails, a built-in fallback list is used so the picker is
  never empty.
- Reasoning-effort control is not exposed — Copilot Chat's model picker has no
  reasoning-effort UI. The default reasoning level is used.
- Image input is not advertised (`imageInput: false`).
