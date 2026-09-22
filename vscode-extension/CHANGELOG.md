# Changelog

All notable changes to the ZRO VS Code extension are documented here.

## [Unreleased]

### Added

- **Per-model pricing.** Published rates — USD per 1M tokens, with any live
  promotion already applied — now show on each model's row in the Copilot Chat
  model picker, and as a **Cost** line plus a low/high-cost badge in the row's
  hover card. Models the control plane publishes no rate for (e.g. `Auto`) are
  left exactly as they were.
- **Dashboard → Models tab** shows the same price on each model row.

### Changed

- Requires control-plane pricing support in `/api/cli/models`. Against an older
  control plane, or for a model with no published rate, the picker simply shows
  no price.

## [0.1.2] — 2026-09-16

### Added

- **Thinking effort for reasoning models.** Reasoning models advertise their own
  effort levels (from the live catalog), and the level is selectable per model in
  Copilot Chat: the model's own **Thinking Effort** control in the model picker,
  where VS Code renders per-model options.
- **Dashboard → Models tab**: every reasoning model has an **Effort** chevron that
  opens a submenu of that model's levels (label, description, and a check on the
  active one), plus **Default** to hand the choice back to the control plane. A
  pill shows whether the level comes from the model, a per-model override, or the
  server.
- **`ZRO: Set reasoning effort`** command: pick a model (or *Global default*) and
  a level.
- **`zro.reasoningEffort`** (all models) and **`zro.reasoningEffortByModel`**
  (per model) settings for when you'd rather configure effort in `settings.json`.
- **Token usage reporting**, so Copilot Chat's context-usage meter and Session Info
  popover work for ZRO models instead of staying empty.

### Changed

- Effort levels always come from the live catalog, so the choices offered match
  what the model actually supports. A level a model doesn't support falls back to
  that model's default rather than erroring.
- Precedence is: explicit request option → your in-picker choice → per-model
  setting → global setting → the model's native default.

## [0.1.1]

First Marketplace release.

### Added

- ZRO models in the Copilot Chat model picker, discovered live from the control
  plane catalog.
- **ZRO** sidebar dashboard: connection state, model catalog, cost, prompt cache,
  and team views.
- Device-code **browser sign-in** (`ZRO: Sign in with browser`) and manual API key
  entry (`ZRO: Enter API key`), plus `ZRO_API_KEY` environment support.
- **`ZRO: Configure in other extensions`** for Cline, Continue, and Roo Code.
- Streaming chat completions with tool calling against the ZRO `/v1` endpoint.