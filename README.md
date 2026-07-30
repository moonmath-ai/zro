# zro

`zro` launches supported coding agents through the Zro inference endpoint using isolated,
Zro-owned configuration. It leaves each agent's normal configuration untouched and starts website
login automatically when needed.

```bash
npm install --global @moonmath-ai/zro
zro login
zro claude
```

## Usage

```bash
zro                         # interactive agent picker
zro claude                  # open directly on the default model
zro codex -m glm-5.2        # choose a model for this session
zro kilo -m minimax-m3      # launch Kilo Code through Zro
zro omp -m glm-5.2          # launch Oh My Pi through Zro
zro oc -- --help            # short aliases + native tool arguments
zro again                   # reopen the last tool/model pair
zro login                   # choose website or API key login
zro login --no-browser      # print an approval URL for a remote machine
zro login --manual          # enter an API key manually
zro logout                  # remove the stored login
zro status                  # connection, installed tools, last session
zro models                  # readable model catalog
zro install claude          # install a supported agent
zro claude --install        # install if missing, then open
zro install claude@2.1.105  # install a pinned agent version
zro install claude --upgrade # upgrade one agent
zro install --upgrade       # upgrade zro itself
zro claude --dry-run        # secret-safe session preview
zro codex --json            # machine-readable preview
```

## Supported tools

Claude Code, Codex CLI, Codex App, Grok Build, Kilo Code, Oh My Pi, OpenCode, Hermes, OpenClaw, and Pi are supported.
Each adapter launches the installed tool as a child process with isolated configuration. Most
session files are temporary; Codex App uses a persistent Zro-owned home so the desktop app can
reopen. Native tool arguments can be placed after `--`.

## Installation and upgrades

Zro requires Node.js 18 or later and supports macOS, Linux, and Windows. Windows launches npm
command shims through the built-in Windows PowerShell runtime.

`zro install <tool>` installs npm-distributed agents globally. Hermes, Grok Build, and Oh My Pi use
their official shell installers; Oh My Pi uses its prebuilt binary so Bun is not required. Add
`--upgrade` to update an installed agent, or pin an npm-distributed agent version with either
`tool@version` or `--version version`.

On Windows, agents distributed through npm can be installed by Zro. The official Hermes, Grok
Build, and Oh My Pi installers require Bash; install those agents separately before launching them
with Zro, or use WSL for their installer flow.

`zro <tool> --install` installs a missing agent and opens it in one command. `zro install
--upgrade` upgrades the Zro CLI itself. Version validation and installer errors are reported directly
by npm or the tool's official installer.

## Authentication

Run `zro login` and choose **Login with website** or **Login with API key**. Use
`zro login --manual` to go directly to API-key entry, or `zro login --no-browser` to start
website login without opening a browser automatically.

Website login creates a revocable API key after approval. The generated key is encrypted to an
ephemeral public key belonging to the CLI, so the device-login database record never contains a
usable plaintext credential. The CLI sends a generic device label unless `ZRO_DEVICE_NAME` is
explicitly set.

If website login cannot start in an interactive terminal, `zro` immediately falls back to a masked
API-key paste prompt. Non-interactive commands still exit with instructions instead of waiting for
input.

`ZRO_API_KEY` takes precedence over the stored key. The primary credential is stored under
`~/.config/zro/credentials.json`. Codex App also keeps the active key in its isolated app home at
`~/.config/zro/codex-app/.env`; `zro logout` removes both stored copies. An environment-provided
`ZRO_API_KEY` remains set in the current shell after logout.

The last tool/model pair is stored in `~/.config/zro/preferences.json`. Set `ZRO_AUTH_URL` to use a
development authentication server. For remote development with a browser-side port forward, set
`ZRO_PUBLIC_URL` to the forwarded website origin.

Before starting an agent, `zro` verifies the selected credential with the inference API. Rejected
credentials and unavailable validation endpoints stop the launch instead of passing the failure to
the child agent.

When logged in, `zro status` also shows the current plan allowance, usage-pack balance, total
available spend, and 30-day request and token activity. JSON output includes the same account data.

## Safety

- Normal agent configs are never edited.
- Temporary session files live under `~/.cache/zro/sessions` and are removed when the agent exits.
- Kilo Code runs with a temporary home and XDG profile. Zro copies only sanitized preferences and
  safe agent/command/skill assets; provider credentials, MCP definitions, sessions, databases,
  dependency trees, and symlinks remain outside the profile.
- Kilo telemetry, OTLP export, automatic updates, model-catalog refresh, cloud session ingest and
  sharing, remote control, and default vendor plugins are disabled. Model and MCP requests still go
  to their configured Zro endpoints.
- Oh My Pi runs with a temporary home, XDG roots, agent directory, and model cache. Zro copies only
  sanitized display preferences and local agent/command/prompt/skill/theme assets; auth state,
  databases, sessions, dependency trees, secret files, and symlinks stay outside the profile.
- Oh My Pi OTLP export, Auto QA reporting, startup update checks, marketplace updates, remote
  memory, and remote compaction are disabled. Its Zro model and MCP files contain environment
  variable names rather than API-key values.
- Codex App uses persistent configuration under `~/.config/zro/codex-app`; logout removes its key.
- API keys are masked in human and JSON previews.
- `--dry-run` writes nothing and starts nothing.
- macOS, Linux, and Windows are supported.

See [SECURITY.md](SECURITY.md) for the security model and private vulnerability reporting.

## Development

```bash
npm ci
npm test
npm run build
node dist/cli.js status

# Production compatibility and live API checks require a real key.
ZRO_API_KEY=sk-... npm run test:clients
ZRO_API_KEY=sk-... npm run test:live
```

## License

Zro is licensed under the [MIT License](LICENSE).
