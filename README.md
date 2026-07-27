# zro

`zro` opens coding agents against the Zro inference endpoint without modifying their normal
configuration. The tool is the command, setup happens in context, and launching before logging in
starts the website login automatically.

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

The original forms still work during migration:

```bash
zro login
zro logout
zro auth status
zro launch claude
```

## Supported tools

Claude Code, Codex CLI, Codex App, Grok Build, OpenCode, Hermes, OpenClaw, and Pi are supported.
Each adapter creates a session-owned configuration and launches the installed tool as a child
process. Native tool arguments can be placed after `--`.

## Installation and upgrades

`zro install <tool>` installs npm-distributed agents globally. Hermes uses its official shell
installer; Grok Build prints its upstream installation instructions. Add `--upgrade` to update an
installed agent, or pin an npm version with either `tool@version` or `--version version`.

`zro <tool> --install` installs a missing agent and opens it in one command. `zro install
--upgrade` upgrades the Zro CLI itself. Before normal launches, Zro checks for a newer CLI release
at most once every 24 hours and offers an interactive upgrade when attached to a terminal.

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

`ZRO_API_KEY` takes precedence over the stored key. Credentials are stored under
`~/.config/zro/credentials.json`, and the last tool/model pair is stored in
`~/.config/zro/preferences.json`. Set `ZRO_AUTH_URL` to use a development authentication server.
For remote development with a browser-side port forward, set `ZRO_PUBLIC_URL` to the forwarded
website origin.
Before starting an agent, `zro` verifies the selected credential with the inference API. Rejected
credentials and unavailable validation endpoints stop the launch instead of passing the failure to
the child agent.

When logged in, `zro status` also shows the current plan allowance, usage-pack balance, total
available spend, and 30-day request and token activity. JSON output includes the same account data.

## Safety

- Normal agent configs are never edited.
- Per-session files live under `~/.cache/zro/sessions` and are removed when the agent exits.
- API keys are masked in human and JSON previews.
- `--dry-run` writes nothing and starts nothing.
- macOS and Linux are supported; use WSL on Windows.

See [SECURITY.md](SECURITY.md) for the security model and private vulnerability reporting.

## Repository scope

This repository contains only the distributable CLI, its tool adapters, tests, and documentation.
The Zro website, billing system, API-key issuer, inference control plane, and deployment
infrastructure are maintained separately.

## Development

```bash
npm install
npm test
npm run build
node dist/cli.js status

# Production compatibility and live API checks require a real key.
ZRO_API_KEY=sk-... npm run test:clients
ZRO_API_KEY=sk-... npm run test:live
```

## License

No open-source license has been selected yet. Until a license is added, no permission is granted
to copy, modify, or redistribute this source code.
