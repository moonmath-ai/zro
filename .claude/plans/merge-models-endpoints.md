# Plan: Merge Models + Endpoints tabs, clarify Select, keep live status

## Goal
Merge the **Models** and **Endpoints** tabs into a single **Models** tab. Keep the per-model "Live" status. Clarify what the "Select" button does. Do **not** add model region (regions are shown in the API key edit/create window, not here).

## Changes (single file: `vscode-extension/media/dashboard.html`)

### 1. Remove the Endpoints tab
- Delete the `<button class="tab" data-tab="endpoints">` tab button (~line 119).
- Delete the entire `<section class="pane" id="pane-endpoints">` block (~lines 164-171).

### 2. Merge endpoints content into the Models tab
The Endpoints tab currently shows each model with a green "Live" pill + a notice about out-of-band provisioning. Move both into the Models list:

- Update the Models card heading/description to reflect that it now also shows live status (e.g. "Models & endpoints").
- In `renderModels()`, add a green "Live" pill per model row (right side, next to the select button).
- Append the "Endpoint provisioning is managed out-of-band…" notice once at the bottom of the models list.

### 3. Clarify the Select button
Currently labeled "Select" / "Selected" — purpose (set default model for Copilot Chat) is unclear. Change to:
- Button text: "Set as default" when unselected, "Current default" when selected.
- Add `title` tooltip: "Use this model as the default in Copilot Chat".
- Keep the existing `.selected` green styling.
- Relabel the catalog-default tag from "default" to "catalog default" to avoid confusion with the user's chosen default.

### 4. Remove dead code
- Delete the `renderEndpoints()` function.
- Remove `renderEndpoints` from the `renderAll()` sections array.

## Layout of a merged model row
```
[displayName]  [catalog default tag]          [Live]  [Set as default / Current default]
model-id
ctx · out
```
Add a small `.m-right` flex container to hold the pill + button.

## What is NOT changing
- `dashboard.ts` — no logic changes; the `manageEndpoint` message handler stays (harmless, no longer reachable from UI).
- No region display (per user — regions are shown in the API key edit/create window).
- No control-plane changes.

## Verification
- `npm run compile` (tsc) in vscode-extension passes.
- `npm run test` (vitest) — existing 50 tests still pass (no TS logic changes, dashboard.html is not unit-tested).
- `npm run package` builds a VSIX; manual check of the dashboard after Reload Window.
