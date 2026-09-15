# Publish ZRO VS Code Extension — TODO

Steps to publish the ZRO extension to the Visual Studio Code Marketplace.

## 1. Create a Publisher on the Marketplace

- [ ] Go to https://marketplace.visualstudio.com/manage and sign in with the Microsoft account (or AAD/Entra ID) that will own the extension.
- [ ] Click **Create publisher**, pick a publisher ID — must match `MoonMathAi` in `package.json:3` exactly.
- [ ] Verify your domain if prompted.

> **Publisher ID vs Name.** The Marketplace form has two fields: **ID** (used in
> `package.json` and in extension URLs, immutable once created) and **Name** (the
> human-friendly brand shown on your listing).
>
> | Field | Value |
> | --- | --- |
> | ID | `MoonMathAi` |
> | Name | `MoonMath.Ai` |
>
> `vsce` only accepts `[a-z0-9-]` for the ID, so a dotted value such as
> `MoonMath.Ai` is rejected outright:
>
> ```
> ERROR  Invalid extension "publisher": "MoonMath.Ai" in package.json.
>        Expected the identifier of a publisher, not its human-friendly name.
> ```

## 2. Generate a Personal Access Token (PAT)

You need an Azure DevOps PAT — `vsce` authenticates through Azure DevOps, not the Marketplace directly.

- [ ] Go to https://dev.azure.com/moonmath-ai (create an org if you don't have one).
- [ ] User settings → **Personal access tokens** → New Token.
- [ ] Organization: **All accessible organizations** (important — otherwise publish fails).
- [ ] Scopes: **Custom defined** → find **Marketplace** → check **Acquire** and **Manage**.
- [ ] Set an expiry (90 days is reasonable; regenerate on each publish).

## 3. Fill in required package.json fields

The Marketplace rejects extensions missing required metadata.

- [ ] `name`, `publisher`, `version`, `engines.vscode` — ✅ present
- [ ] `description` — ✅ present
- [ ] `categories` — ✅ present (`AI`, `Chat`)
- [ ] `keywords` — ❌ add relevant search keywords
- [ ] `license` — ⚠️ `UNLICENSED` won't display a license on the listing; either keep as proprietary or remove the field
- [ ] `repository` — ✅ present
- [ ] `bugs.url` — ❌ add, pointing to GitHub issues for the "Issues" link on the listing
- [ ] `homepage` — ❌ add
- [ ] `icon` — ✅ present (128×128px PNG recommended)
- [ ] `galleryBanner` — ❌ optional but recommended (colored header on the listing)

## 4. Add a CHANGELOG.md

`vsce package`/`publish` warns without one, and the Marketplace shows nothing.

- [ ] Create `vscode-extension/CHANGELOG.md` with a `## [0.1.0]` section.

## 5. Review .vscodeignore

- [ ] Confirm `.vscodeignore` excludes `src/`, `test/`, `node_modules/`, source maps, etc. (already does).
- [ ] Run `npm run package` and check the resulting `.vsix` is small (should be well under 1MB).

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
npx @vscode/vsce login MoonMathAi   # paste the PAT from step 2
npx @vscode/vsce publish
```

The `prepublish` script (`package.json`) already runs `npm run compile`, so the build happens automatically.

- [ ] Log in to vsce
- [ ] Publish

## 7. (Recommended) Publish from CI automatically

Extend the existing workflow to publish automatically on tagged releases.

- [ ] Add a tag condition to a new `publish` job in `.github/workflows/vscode-extension.yml` that only runs on `v*` tags.
- [ ] Store the PAT as a GitHub secret: `VSCE_PAT`.
- [ ] Add a publish step:
      ```yaml
      - name: Publish to Marketplace
        if: startsWith(github.ref, 'refs/tags/v')
        run: npx @vscode/vsce publish -p ${{ secrets.VSCE_PAT }}
        working-directory: vscode-extension
      ```
- [ ] Release flow: bump `version` in package.json → tag `v0.1.0` → push → CI publishes.

## Quick pre-publish checklist

- [ ] Create publisher `MoonMathAi` on the Marketplace
- [ ] Generate Azure DevOps PAT with **Marketplace → Acquire + Manage** scope, **All orgs**
- [ ] Add `keywords`, `bugs.url`, `homepage` to package.json
- [ ] Create `CHANGELOG.md`
- [ ] Run `npm run package` locally and verify the `.vsix` installs: `code --install-extension zro-0.1.0.vsix`
- [ ] Test the extension actually works in a clean VS Code instance
- [ ] `npx @vscode/vsce publish`
