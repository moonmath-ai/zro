# Publish ZRO VS Code Extension — TODO

Steps to publish the ZRO extension to the Visual Studio Code Marketplace.

> `0.1.1` and `0.1.2` are already live, so sections 1–4 are done. This document
> is now the checklist for the **next** release: renew the PAT if it has expired
> (section 2), pick the version bump, and run section 6.

## 1. Create a Publisher on the Marketplace — done

- [x] Go to https://marketplace.visualstudio.com/manage and sign in with the Microsoft account (or AAD/Entra ID) that will own the extension.
- [x] Click **Create publisher**. The publisher ID is `moonmathai` (lowercase), which is what `package.json:3` now carries.
- [x] Verify your domain if prompted.

> **Publisher ID vs Name.** The Marketplace form has two fields: **ID** (used in
> `package.json` and in extension URLs, immutable once created) and **Name** (the
> human-friendly brand shown on your listing).
>
> | Field | Value |
> | --- | --- |
> | ID | `moonmathai` |
> | Name | `MoonMath.Ai` |
>
> The ID is stored lowercase — an install lands in
> `~/.vscode/extensions/moonmathai.zro-<version>`. `package.json` must carry the
> **ID**, never the Name.
>
> `vsce` only accepts `[a-z0-9-]` for the ID, so a dotted value such as
> `MoonMath.Ai` is rejected outright:
>
> ```
> ERROR  Invalid extension "publisher": "MoonMath.Ai" in package.json.
>        Expected the identifier of a publisher, not its human-friendly name.
> ```

## 2. Generate a Personal Access Token (PAT)

You need an Azure DevOps PAT — `vsce` authenticates through Azure DevOps, not the Marketplace directly. On a repeat release you only need this section if the PAT has expired (they are created with an expiry).

- [ ] Go to https://dev.azure.com/moonmath-ai (create an org if you don't have one).
- [ ] User settings → **Personal access tokens** → New Token.
- [ ] Organization: **All accessible organizations** (important — otherwise publish fails).
- [ ] Scopes: **Custom defined** → find **Marketplace** → check **Acquire** and **Manage**.
- [ ] Set an expiry (90 days is reasonable; regenerate on each publish).

## 3. Fill in required package.json fields

The Marketplace rejects extensions missing required metadata.

- [x] `name`, `publisher`, `version`, `engines.vscode` — present
- [x] `description` — present
- [x] `categories` — present (`AI`, `Chat`)
- [x] `keywords` — present
- [ ] `license` — ⚠️ `UNLICENSED` displays no license on the listing. Deliberate for a proprietary extension; revisit only if that changes.
- [x] `repository` — present
- [x] `bugs.url` — present (GitHub issues)
- [x] `homepage` — present
- [x] `icon` — present (`media/icon.png`)
- [ ] `galleryBanner` — not set. Optional; add a brand colour if we want the coloured listing header.

## 4. Update the CHANGELOG

`vsce package`/`publish` warns without one, and the Marketplace shows nothing.

- [x] `vscode-extension/CHANGELOG.md` exists.
- [ ] On each release, rename the `## [Unreleased]` heading to `## [<version>] — <date>` before publishing.

## 5. Review .vscodeignore

- [x] `.vscodeignore` excludes `src/`, `test/`, `node_modules/`, source maps, dev scripts, and the screenshot harness.
- [ ] Run `npm run package` and check the resulting `.vsix` is small (should be well under 1MB).
- [ ] Confirm `scripts/capture-log.jsonl` is **not** packaged. Local proxy captures hold a **live API key** — the file is gitignored and must never be committed or shipped.

## 6. Publish

The `publish` script runs the whole pipeline: preflight checks → compile →
tests → package → confirm → upload.

```bash
cd vscode-extension
npm run publish                    # publish the version in package.json
```

Useful variants:

```bash
npm run publish -- --dry-run       # validate + package, but don't upload
npm run publish -- patch           # bump patch, then publish
npm run publish -- minor --yes     # bump minor, skip the confirmation prompt
```

Preflight flags a missing publisher ID, a malformed one, missing icon assets,
a dirty working tree, missing `keywords`/`repository`/`CHANGELOG.md`, and a
version that is already live. It also validates the extension name and
publisher ID against the same pattern `vsce` uses.

For CI, export the PAT instead of logging in:

```bash
VSCE_PAT=<YOUR_PAT> npm run publish -- --yes
```

### Manual equivalent

```bash
cd vscode-extension
npm run compile
npx @vscode/vsce login moonmathai   # paste the PAT from step 2
npx @vscode/vsce publish
```

The `prepublish` script (`package.json`) already runs `npm run compile`, so the build happens automatically.

- [x] Log in to vsce
- [x] Publish `0.1.1` and `0.1.2`
- [ ] Publish the current version

## 7. (Recommended) Publish from CI automatically — not done

The repository's `publish.yml` publishes the **npm CLI**, not the extension, so
the extension still needs a workflow of its own.

Extend the extension workflow to publish automatically on tagged releases.

- [ ] Add a tag condition to a new `publish` job in `.github/workflows/vscode-extension.yml` that only runs on `v*` tags.
- [ ] Store the PAT as a GitHub secret: `VSCE_PAT`.
- [ ] Add a publish step:
      ```yaml
      - name: Publish to Marketplace
        if: startsWith(github.ref, 'refs/tags/v')
        run: npx @vscode/vsce publish -p ${{ secrets.VSCE_PAT }}
        working-directory: vscode-extension
      ```
- [ ] Release flow: bump `version` in `vscode-extension/package.json` → tag `v0.1.3` → push → CI publishes.

## Quick pre-publish checklist

Everything below is per-release; the one-time setup is already done.

- [ ] Decide the version bump and set `version` in `package.json`
- [ ] Finalise `CHANGELOG.md` (`## [Unreleased]` → `## [<version>] — <date>`)
- [ ] `npm run compile` and `npm test` are green
- [ ] `npm run publish -- --dry-run` passes preflight and produces a small `.vsix`
- [ ] Install that `.vsix` (`code --install-extension zro-<version>.vsix`) and confirm the extension works in a clean VS Code instance
- [ ] Renew the Azure DevOps PAT if it has expired
- [ ] `npx @vscode/vsce publish`
