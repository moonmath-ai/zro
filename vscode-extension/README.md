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

1. **Already logged in via the CLI** — run `zro login` once. The extension reads
   the same `~/.config/zro/credentials.json` file, so no further setup is needed.
2. **From VS Code** — run the `ZRO: Enter API key` (or `ZRO: Log in`) command from
   the Command Palette and paste a ZRO API key. It is stored in VS Code's
   SecretStorage.
3. **For CI / power users** — set the `ZRO_API_KEY` environment variable. It takes
   precedence over the other two.

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

## Notes

- The model catalog is fetched live from the control plane's `/api/cli/models`
  endpoint on every picker refresh, filtered to the models currently active in
  LiteLLM. If that fetch fails, a built-in fallback list is used so the picker is
  never empty.
- Reasoning-effort control is not exposed — Copilot Chat's model picker has no
  reasoning-effort UI. The default reasoning level is used.
- Image input is not advertised (`imageInput: false`).
