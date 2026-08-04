# ZRO for VS Code

Registers [ZRO](https://zro.moonmath.ai) as a Copilot Chat model provider. Once installed,
ZRO models appear in the Copilot Chat model picker and chat requests stream through the Zro
inference endpoint. The model catalog is discovered dynamically from the control plane and falls
back to a built-in list when the endpoint is unreachable.

## Install

### From a .vsix

```bash
code --install-extension zro-0.1.0.vsix
```

Or in VS Code: Extensions → `…` → *Install from VSIX…*.

### From source

```bash
cd zro/vscode-extension
npm install
npm run compile
npm run package   # produces zro-0.1.0.vsix
```

## Authenticate

Pick one — all three use the same credential resolution order:

1. **Already logged in via the CLI** — run `zro login` once. The extension reads the same
   `~/.config/zro/credentials.json` file, so no further setup is needed.
2. **From VS Code** — run the `ZRO: Enter API key` (or `ZRO: Log in`) command from the
   Command Palette and paste a ZRO API key. It is stored in VS Code's SecretStorage.
3. **For CI / power users** — set the `ZRO_API_KEY` environment variable. It takes precedence over
   the other two.

## Use

1. Open Copilot Chat (`⌘⇧I` / `Ctrl+Shift+I`).
2. Pick a model from the dropdown — ZRO models are prefixed with `ZRO`.
3. Chat as usual. Responses stream from the Zro endpoint; tool calls (file edits, terminal, etc.)
   round-trip through Copilot Chat's agent loop.

## Configuration

| Setting | Purpose | Default |
| --- | --- | --- |
| `ZRO_API_KEY` (env) | API key — overrides everything else | — |
| `ZRO_ENDPOINT_ROOT` (env) | Inference + catalog endpoint root | `https://zro.moonmath.ai` |

## Notes

- The model catalog is fetched live from the control plane's `/api/cli/models` endpoint on every
  picker refresh, filtered to the models currently active in LiteLLM. If that fetch fails, a
  built-in fallback list is used so the picker is never empty.
- Reasoning-effort control is not exposed — Copilot Chat's model picker has no reasoning-effort
  UI. The default reasoning level is used.
- Image input is not advertised (`imageInput: false`).
