# Set up zro with a coding agent

Copy one of the prompts below into a coding agent.

## Install zro and launch an agent (end user)

Prefer this when the user wants to start using zro on this machine.

```text
Set up zro on this machine and verify it works.

Repository/package: @moonmath-ai/zro — a CLI that launches coding agents through the Zro
inference endpoint. Docs: https://github.com/moonmath-ai/zro.

Work like a careful onboarding engineer: perform the setup yourself, explain only decisions or
blockers, and verify through the CLI. Never print, log, commit, or paste API keys.

Safety rules:

- Never print, log, commit, or paste API keys or tokens.
- Do not overwrite or edit the user's existing agent configurations.
- Treat ZRO_API_KEY and any stored credential as security-sensitive.

Before making changes, ask:

1. Install zro globally with npm or pnpm? (Recommend npm install --global @moonmath-ai/zro.)
2. Which login do you want?
   - Website login (recommended): `zro login`
   - API key: `zro login --manual`
   - Defer: set up login but do not require it now.
3. Which agent should I verify with? (Default: claude, or any installed agent.)

Preflight:

- Verify Node.js >= 18 and npm (or pnpm) are available.
- Confirm the `zro` binary is on PATH after install.

Setup:

1. Install the package: `npm install --global @moonmath-ai/zro` (or `pnpm add --global @moonmath-ai/zro`).
2. Run `zro login` (or `zro login --manual`) per the user's choice and complete sign-in.
3. Install the chosen agent if needed: `zro install <tool>`.
4. Launch it: `zro <tool>` (or `zro <tool> --dry-run` for a secret-safe preview).

Verification:

- `zro status` reports connected=true and shows the installed tools.
- `zro <agent> --dry-run` prints a session preview without launching anything.
- If possible, launch the agent and confirm it starts.

When finished, report the installed version, the chosen login method, which agents are installed,
and how to launch one.
```

## Local development setup (source checkout)

Use this for contributing to zro itself.

```text
Set up the zro repository for local development.

Repository: https://github.com/moonmath-ai/zro.git

Work like a careful onboarding engineer: perform the setup yourself, explain only decisions or
blockers, and verify with the test/typecheck/build commands.

Safety rules:

- Never print, log, commit, or paste secrets or API keys.
- Do not commit anything as part of setup.
- If the repository already exists, inspect `git status` first and do not discard local changes.

Preflight:

- Verify Node.js >= 18 (22 recommended), pnpm, and Git.
- Use the repo's declared package manager (pnpm). Do not silently swap lockfiles or rewrite
  pnpm-lock.yaml; use `--frozen-lockfile`.

Setup:

1. Clone the repository and enter its root.
2. Read `AGENTS.md`, `README.md`, and `package.json` before acting.
3. Run `pnpm install`.
4. Run `pnpm run typecheck` and `pnpm test`.

Verification:

- `pnpm run typecheck` passes.
- `pnpm test` passes.
- `pnpm run build` produces `dist/`.

When finished, report the Node/pnpm versions, that install/typecheck/test/build all pass, and the
commands to run them.
```