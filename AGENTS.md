# AGENTS.md

Guidance for coding agents (Claude Code, Codex, OpenCode, etc.) working in this repository.

## Repository constraints

- **Public repository**: assume all tracked content and diffs are public. Never commit secrets,
  `.env` files, stored credentials, private URLs, or real production data. Review `git status` and
  the staged diff before committing. If private data appears, stop and alert a maintainer.
- **Dependency-light by design**: the runtime has almost no dependencies. Do not add a dependency
  for something we already handle, and keep new dependencies justified. Prefer the standard library.
- **Keep code simple**: reuse existing primitives, keep a single source of truth, and avoid
  speculative abstractions. Add an interface only when it protects a real external or platform
  boundary (for example an agent adapter).

## Conventions

- TypeScript, Node 18+, ESM. Source in `src/`, tests in `tests/` (vitest).
- Use the `RunIo` abstraction for testable I/O; fetch, spawn, and streams flow through it so unit
  tests can inject fakes (see `tests/run.test.ts`).
- Do not add code comments unless they explain non-obvious decisions.
- Run `pnpm run typecheck` and `pnpm test` before considering work done.
- New commands: wire them through `src/args.ts` → the `CliRequest` union in `src/types.ts` →
  dispatch in `src/run.ts` → `ui.ts` help text. Add `tests/args.test.ts` and `tests/run.test.ts`
  coverage.
- The CI script `scripts/ci/check-version.mjs` uses the `semver` dev dependency; keep it.

## Security-sensitive areas

Treat credential handling, key storage, `--dry-run` previews, and agent-profile isolation as
security-sensitive. API keys must be masked in all human and JSON output. Never write a plaintext
credential into a generated agent config.

## After opening a pull request

Stay with the PR until CI and any automated review have finished. Poll checks, reviews, and review
threads; address every actionable issue, push fixes, and repeat until no actionable feedback
remains. Do not merge while checks are pending or review issues are unresolved.