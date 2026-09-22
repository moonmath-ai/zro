# Changelog

Notable product changes in zro — for people following the repo, not a dump of every commit. GitHub
Releases still mark tagged builds.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Highlights

- **Claude Code model tiers map to Zro models.** Claude Code's opus / sonnet / fable / haiku
  aliases now resolve to Zro models derived from the active catalog (tier-mapped by output
  capacity), so background and subagent work never falls through to models the Zro endpoint
  cannot serve. Override or drop any slot per launch with `--alias`: `zro claude --alias
  opus=glm-5.3 --alias haiku=`.
- The bundled fallback catalog tracks the live lineup: `deepseek-v4.1-flash` (new default),
  `glm-5.3`, `glm-5.3-flash`, `dolly1-security`, `auto`, and `kimi-k3` replace the retired
  `glm-5.2` and `deepseek-v4-flash-0731` entries.

### Fixed

- Claude Code compacts at each model's real context window instead of assuming 200k: Zro sets
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` from the catalog and launches 1M-context models with the
  `[1m]` suffix. Secret redaction no longer masks `CONTEXT_TOKENS` as a credential.

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