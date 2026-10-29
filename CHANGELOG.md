# Changelog

Notable product changes in zro — for people following the repo, not a dump of every commit. GitHub
Releases still mark tagged builds.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.2] - 2026-10-29

### Tools

- **OpenCode 2 support.** `zro install opencode2` (aliases `oc2` and `opencode-v2`) launches the
  OpenCode 2 client/server agent with isolated config, `--standalone`, Zro models, and MCP.
- OpenCode and OpenCode 2 config copies now skip symlinks and credential files
  (`service.json`, `auth.json`, `mcp-auth.json`, `.env*`).

## [0.4.1] - 2026-10-28

### Added

- `zro status` shows a Free plan account as Free, with the share of today's usage left and
  when it resets. Servers that do not send this keep the previous output.

## [0.4.0] - 2026-10-26

### Added

- `--inference-url <url>` and `ZRO_INFERENCE_URL` point inference at another
  OpenAI-compatible gateway. A root or `/v1` URL works, and the override wins over
  `ZRO_ENDPOINT_ROOT` and the default endpoint. Login, the authenticated catalog,
  feedback, and MCP stay on the control-plane URL.
- `--no-auth` and `ZRO_NO_AUTH=1` launch agents against an inference endpoint with no Zro
  account. No-auth mode requires an explicit inference override, skips key resolution
  and Authorization headers, loads public model metadata from
  `/api/cli/models/public`, intersects it with the gateway's live `/v1/models` list,
  caches it separately as `model-catalog-public.json`, and omits the Zro MCP server.
  `zro models` and `zro status` work in this mode; `zro feedback` does not.

### Fixed

- Prime Agent 0.10.1 launches now use its `settings.json` MCP format and no longer pass the
  removed `--extension` or `--no-tools` flags.

## [0.3.0] - 2026-10-05

### Highlights

- **Windows support.** `zro` now runs natively on Windows; WSL is no longer required. npm-installed
  agents (`.cmd` shims) are found through `PATHEXT` and launched through `cmd.exe`, and
  `zro login` opens the browser with `explorer.exe`.
- **The model catalog comes from the Zro API.** Models load from the authenticated
  `/api/cli/models` endpoint and are cached locally, so new models reach users without a CLI
  release. A failed fetch falls back to the cached catalog; a rejected key clears it.

### Changed

- The bundled fallback catalog is removed. Signed-out users with no cached catalog are asked to run
  `zro login`, and a signed-in user with no cache sees a clear "could not reach the Zro model
  catalog" error if the first fetch fails.
- `zro <tool>` offers to install a missing agent in an interactive terminal. Dry runs never install.
- `zro status` no longer lists installed tools.
- README rewritten product-first, with pricing and links to zro.moonmath.ai.

### Tooling

- CI runs the test suite on `windows-latest` alongside the Ubuntu matrix, and the build uses a
  cross-platform `scripts/build.mjs`.

## [0.2.5] - 2026-09-27

### Fixed

- Claude Code and Hermes launches now carry the catalog's max-output budget, not just the window
  budget: Claude Code gets `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (the smallest cap across the selection
  and seated tier slots, same one-budget-per-launch rule as the context window), and Hermes gets
  top-level `model.max_tokens` for the selected model. Codex stays without one — its config schema
  rejects unknown fields and its model catalog has no such entry, so nothing is emitted there.

## [0.2.4] - 2026-09-24

### Highlights

- **Claude Code model tiers map to Zro models.** Claude Code's opus / sonnet / fable / haiku
  aliases now resolve to Zro models derived from the active catalog (tier-mapped by output
  capacity with deterministic tie-breaks), so background and subagent work never falls through to
  models the Zro endpoint cannot serve. Explicit slots are reserved and the rest backfill around
  them. Override or drop any slot per launch with `--alias`: `zro claude --alias opus=glm-5.3
  --alias haiku=`.
- The bundled fallback catalog tracks the live lineup: `deepseek-v4.1-flash` (new default),
  `glm-5.3`, `glm-5.3-flash`, `dolly1-security`, `auto`, and `kimi-k3` replace the retired
  `glm-5.2` and `deepseek-v4-flash-0731` entries.

### Fixed

- Claude Code compacts at each model's real context window instead of assuming 200k: Zro sets
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` from the catalog and launches 1M-context models with the
  `[1m]` suffix. Secret redaction no longer masks `CONTEXT_TOKENS` as a credential, and the
  segment-based matcher keeps masking every `*_API_KEY` / `*_TOKEN` / `*_AUTHORIZATION`-style name.
- Codex configs for the new lineup now carry documented reasoning efforts (`xhigh` for maximum,
  `medium` for the Auto router) instead of bare level IDs like `max` or `auto`.

### Tooling

- Harness CI jobs run on Node 24; OpenClaw's installer rejects the Node 22 runner version.

### Highlights

- Open-sourcing: a full contributor package — CONTRIBUTING, AGENTS, SECURITY, SETUP_PROMPT, and a
  rewritten README with a dark/light-aware logo.
- The project moves from npm to **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Publish still
  uses the npm CLI so releases keep npm's OIDC trusted-publisher flow.

### Tooling

- Switch the package manager to pnpm; CI installs and checks now run on pnpm.

## [0.2.3] - 2026-09-01

### Highlights

- **`zro feedback`** — send feedback to the Zro team straight from the terminal. Logged-in users
  post to `/api/cli/feedback` with a minimal, privacy-first payload.

### Commands

- `zro feedback [message]` — send feedback; reads a positional message or prompts interactively,
  supports `--json`, and never writes or logs the API key.

### Agent support

- CI now discovers and exercises every supported agent (Claude, Codex, Grok, Kilo, Oh My Pi,
  OpenCode, Hermes, OpenClaw, Pi, Prime) across macOS and Linux.

### CI & releases

- Releases are **tag-based** (`v*` tags) and published by the `Publish` workflow.