<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/zro-logo-white.png">
    <img src="./docs/zro-logo.png" alt="zro" width="160" />
  </picture>
</p>

# zro

Launch the coding agent of your choice through the Zro inference endpoint — with isolated,
Zro-owned configuration that never touches your normal agent setup.

`zro` is a thin, dependency-light CLI that opens supported coding agents (Claude Code, Codex,
Kilo Code, OpenCode, and more) against the [Zro](https://zro.moonmath.ai) inference platform. Each
agent runs as a child process with its own temporary profile, so your everyday agent
configuration, credentials, and session history are left completely untouched. Website login is
started automatically when needed.

```bash
npm install --global @moonmath-ai/zro
zro login
zro claude
```

---

## Installation and upgrades

### Requirements

- **Node.js 22 or later**
- **macOS** or **Linux** (on Windows, use [WSL](https://learn.microsoft.com/en-us/windows/wsl/))

### Install

```bash
npm install --global @moonmath-ai/zro
```

Zro is also on [pnpm](https://pnpm.io/):

```bash
pnpm add --global @moonmath-ai/zro
```

### Upgrades

- `zro install --upgrade` upgrades the Zro CLI itself.
- `zro install <tool> --upgrade` upgrades one installed agent.
- `zro install claude@2.1.105` or `zro install claude --version 2.1.105` pins an npm-distributed
  agent version.

`zro install <tool>` installs npm-distributed agents globally. Hermes, Grok Build, and Oh My Pi use
their official shell installers; Oh My Pi ships a prebuilt binary so Bun is not required. Version
validation and installer errors are reported directly by npm or the tool's official installer.

### Authentication

Sign in once with `zro login`, then launch any supported agent:

```bash
zro login                        # choose website or API key login
zro login --manual               # enter an API key directly
zro login --no-browser           # print an approval URL (e.g. for a remote box)
zro logout                       # remove the stored login
```

- **Website login** creates a revocable API key after approval. The generated key is encrypted to an
  ephemeral public key belonging to the CLI, so the device-login record never holds a usable
  plaintext credential. The CLI sends a generic device label unless `ZRO_DEVICE_NAME` is set.
- **Fallback:** if website login can't start in an interactive terminal, `zro` falls back to a
  masked API-key paste prompt. Non-interactive commands exit with instructions instead of waiting.
- **Environment key:** `ZRO_API_KEY` takes precedence over the stored key. The primary credential
  lives at `~/.config/zro/credentials.json`; Codex App keeps its own copy under
  `~/.config/zro/codex-app/.env`, and `zro logout` removes both.
- Before launching, `zro` verifies the credential with the inference API. Rejected keys and
  unavailable validation endpoints stop the launch rather than passing the failure to the child
  agent.

---

## Quick start

```bash
zro login
zro claude            # open Claude Code on the default model
zro codex -m glm-5.2  # pick a model for this session
```

`zro <tool> --install` installs a missing agent and opens it in one step.

---

## Usage

```bash
zro                         # interactive agent picker
zro claude                  # open directly on the default model
zro codex -m glm-5.2        # choose a model for this session
zro kilo -m glm-5.2         # launch Kilo Code through Zro
zro omp -m glm-5.2          # launch Oh My Pi through Zro
zro oc -- --help            # short aliases + native tool arguments
zro again                   # reopen the last tool/model pair
zro login                   # choose website or API key login
zro login --no-browser      # print an approval URL for a remote machine
zro login --manual          # enter an API key manually
zro logout                  # remove the stored login
zro status                  # connection, installed tools, last session, usage
zro models                  # readable model catalog
zro install claude          # install a supported agent
zro claude --install        # install if missing, then open
zro install claude@2.1.105  # install a pinned agent version
zro install --upgrade       # upgrade zro itself
zro feedback                # send feedback to the Zro team
zro claude --dry-run        # secret-safe session preview
zro codex --json            # machine-readable preview
```

Pass native tool arguments after `--` (for example `zro oc -- --help`). The last
tool/model pair is remembered and reopened with `zro again`.

---

## Supported tools

| Agent | Install | Notes |
| --- | --- | --- |
| [Claude Code](https://www.anthropic.com/claude-code) | `zro install claude` | Anthropic's coding agent |
| [Codex CLI](https://developers.openai.com/codex/) | `zro install codex` | OpenAI's terminal agent |
| [Codex App](https://developers.openai.com/codex/) | `zro install codex-app` | OpenAI's desktop app (persistent Zro-owned home) |
| [Kilo Code](https://kilocode.ai/) | `zro install kilo` | Kilo's terminal coding agent |
| [Oh My Pi](https://ohmy.ai) | `zro install omp` | Power-user terminal agent |
| [OpenCode](https://opencode.ai) | `zro install opencode` | Open-source coding agent |
| [Grok Build](https://x.ai) | `zro install grok` | xAI's coding agent |
| [Hermes](https://hermes-agent.nousresearch.com) | `zro install hermes` | Nous Research's agent |
| [OpenClaw](https://github.com/openclaw/openclaw) | `zro install openclaw` | Personal AI assistant |
| [Pi](https://github.com/earendil-works/pi) | `zro install pi` | Minimal coding agent |
| [Prime Agent](https://primeintellect.ai) | `zro install prime` | Prime Intellect's self-improving RLM agent |

Each adapter launches the installed tool as a child process with isolated configuration. Most
session files are temporary; Codex App uses a persistent Zro-owned home so the desktop app can
reopen. Pass native tool arguments after `--`.

---

## Safety

- Normal agent configs are never edited.
- Temporary session files live under `~/.cache/zro/sessions` and are removed when the agent exits.
- Kilo Code and Oh My Pi run with a temporary home and XDG profile. Only sanitized preferences and
  safe assets are copied in; provider credentials, MCP definitions, sessions, databases,
  dependency trees, and secret files stay outside the profile.
- Kilo and Oh My Pi telemetry, OTLP export, automatic updates, sharing, and remote control are
  disabled; model and MCP requests still go to the configured Zro endpoints.
- API keys are masked in human and JSON previews. `--dry-run` writes nothing and starts nothing.
- macOS and Linux are supported; use WSL on Windows.

See [SECURITY.md](SECURITY.md) for the security model and private vulnerability reporting.

---

## Contributing

Zro is a small, dependency-free TypeScript CLI. Bug reports, feature requests, and pull requests
are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks, and contribution
guidelines.

---

## License

Zro is licensed under the [MIT License](LICENSE).

<p align="center">
  <a href="https://zro.moonmath.ai">zro.moonmath.ai</a>
</p>