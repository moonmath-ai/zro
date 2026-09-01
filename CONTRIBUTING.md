# Contributing to zro

Thanks for helping improve zro. This is a small, dependency-light TypeScript CLI, so changes should
stay focused, minimal, and easy to review.

## Repository layout

```
src/            CLI source (arg parsing, engine, per-agent adapters, UI)
src/engine/     agent adapters + shared launch plumbing
scripts/ci/     CI scripts (client/live checks, version gate)
tests/          unit tests (vitest)
```

## Local development

Requires Node.js 22+. We use [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm test          # unit tests
pnpm run typecheck # TypeScript type-check
pnpm run build     # compile dist/
node dist/cli.js status
```

### Live integration checks

The production-compatibility and live-API checks need a real key and reachable upstream:

```bash
ZRO_API_KEY=sk-... pnpm run test:clients
ZRO_API_KEY=sk-... pnpm run test:live
```

These are heavy and hit the live Zro inference endpoint; they are not part of the default test run.

## Checks before you open a PR

| Command | Purpose |
| --- | --- |
| `pnpm test` | Unit tests (default, offline) |
| `pnpm run typecheck` | TypeScript type-check |
| `pnpm run build` | Compile `dist/` |

CI runs `typecheck`, `test`, `build`, and a package smoke test on every PR.

## Secrets and configuration

- **Never** commit `.env` files, stored credentials, or API keys.
- **Never** paste keys, tokens, or passwords in issues or PRs.
- Use placeholders in examples (for example `sk-...`).
- This is a **public** repository once open-sourced: assume every tracked file and diff is public.

## Pull requests

- Keep PRs small and reviewable.
- Target the `main` branch.
- Describe what changed and **how you tested** (for example `pnpm test`, manual steps).
- Link related issues when applicable.

## Contact

| Address | Use for |
| --- | --- |
| GitHub Security Advisory | Vulnerabilities only — see [SECURITY.md](SECURITY.md) |
| GitHub Issues | Bugs and feature requests |
| `zro feedback` (in the CLI) | Product feedback to the Zro team |