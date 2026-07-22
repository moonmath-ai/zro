# zro

`zro` opens coding agents against the Zro inference endpoint without modifying their normal
configuration. The tool is the command, setup happens in context, and launching before connecting
starts the website login automatically.

```bash
npm install --global @moonmath-ai/zro
zro connect
zro claude
```

## Usage

```bash
zro                         # interactive agent picker
zro claude                  # open directly on the default model
zro codex -m glm-5.2        # choose a model for this session
zro oc -- --help            # short aliases + native tool arguments
zro again                   # reopen the last tool/model pair
zro connect                 # sign in through the Zro website
zro connect --no-browser    # print an approval URL for a remote machine
zro connect --manual        # enter an API key manually
zro status                  # connection, installed tools, last session
zro models                  # readable model catalog
zro claude --inspect        # secret-safe session preview
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

## Authentication

Website login creates a revocable API key after approval. The generated key is encrypted to an
ephemeral public key belonging to the CLI, so the device-login database record never contains a
usable plaintext credential. The CLI sends a generic device label unless `ZRO_DEVICE_NAME` is
explicitly set.

`ZRO_API_KEY` takes precedence over the stored key. Credentials are stored under
`~/.config/zro/credentials.json`, and the last tool/model pair is stored in
`~/.config/zro/preferences.json`. Set `ZRO_AUTH_URL` to use a development authentication server.

## Safety

- Normal agent configs are never edited.
- Per-session files live under `~/.cache/zro/sessions` and are removed when the agent exits.
- API keys are masked in human and JSON previews.
- `--inspect` writes nothing and starts nothing.
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
```

## License

No open-source license has been selected yet. Until a license is added, no permission is granted
to copy, modify, or redistribute this source code.
