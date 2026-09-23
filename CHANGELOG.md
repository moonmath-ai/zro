# Changelog

Notable product changes in zro — for people following the repo, not a dump of every commit. GitHub
Releases still mark tagged builds.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Highlights

- Open-sourcing: a full contributor package — CONTRIBUTING, AGENTS, SECURITY, SETUP_PROMPT, and a
  rewritten README with a dark/light-aware logo.
- The project moves from npm to **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Publish still
  uses the npm CLI so releases keep npm's OIDC trusted-publisher flow.

### Tooling

- Switch the package manager to pnpm; CI installs and checks now run on pnpm.
- Live and compatibility CI probes resolve their models from the online model
  catalog at run time (picking models that offer the reasoning levels each
  probe needs, and deriving model-list assertions from the catalog) instead of
  hardcoding GLM-5.2, and honor a `ZRO_CI_MODEL` override — retiring a model no
  longer breaks CI.

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