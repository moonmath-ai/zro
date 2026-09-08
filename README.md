<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/zro-logo-white.png">
    <img src="./assets/zro-logo.png" alt="zro" width="160" />
  </picture>
</p>

<div align="center">

# Private, fast inference for coding agents

**Open-weight models. Zero data retention. Zero training. Long-context, multi-region speed.**

[zro.moonmath.ai](https://zro.moonmath.ai) · [Pricing](https://zro.moonmath.ai/pricing) · [Integrations](https://zro.moonmath.ai/integrations)

</div>

`zro` is the CLI that connects your coding agent to the [Zro](https://zro.moonmath.ai)
inference endpoint. It launches the agent of your choice with isolated, Zro-owned
configuration — so it never touches your everyday agent setup, credentials, or session
history.

> No training on your prompts or completions. Zero request retention. Runs on
> privacy-forward, multi-region infrastructure. Optimized for the long-context,
> tool-heavy workloads coding agents depend on.

```bash
npm install --global @moonmath-ai/zro
zro login
zro claude
```

Available now: **GLM-5.2, GLM-5.3 Flash, DeepSeek V4 Flash 0731, and Kimi K3**.
Region availability is shown when you create an API key.

---

## Quick start

```bash
zro login                 # website or API key login
zro claude                # open Claude Code on the default model
zro codex -m glm-5.2      # pick a model for this session
zro models                # browse the model catalog
zro status                # connection, installed tools, last session, usage
```

`zro <tool> --install` installs a missing agent and opens it in one step.

---

## Installation

- **Requirements:** Node.js 22 or later, macOS or Linux (WSL on Windows).
- **Install:** `npm install --global @moonmath-ai/zro` (also `pnpm add --global @moonmath-ai/zro`).
- **Upgrade:** `zro install --upgrade` (upgrade zro); `zro install <tool> --upgrade`
  or `zro install claude@2.1.105` / `zro install claude --version 2.1.105` for an agent.

### Authentication

Sign in once, then launch any supported agent:

```bash
zro login                    # website or API key login
zro login --manual           # enter an API key directly
zro login --no-browser       # print an approval URL (e.g. remote box)
zro logout                   # remove the stored login
```

- Website login creates a revocable API key after approval, encrypted to an ephemeral
  CLI-held public key. Set `ZRO_DEVICE_NAME` to label the device.
- `ZRO_API_KEY` takes precedence over the stored key at `~/.config/zro/credentials.json`;
  Codex App keeps its own copy under `~/.config/zro/codex-app/.env`; `zro logout` removes both.
- The credential is verified against the inference API before any launch.

---

## Supported coding agents

| Agent | Install | Notes |
| --- | --- | --- |
| [Claude Code](https://www.anthropic.com/claude-code) | `zro install claude` | Anthropic's coding agent |
| [Codex CLI](https://developers.openai.com/codex/) | `zro install codex` | OpenAI's terminal agent |
| [Codex App](https://developers.openai.com/codex/) | `zro install codex-app` | OpenAI's desktop app |
| [Kilo Code](https://kilocode.ai/) | `zro install kilo` | Kilo's terminal coding agent |
| [Oh My Pi](https://ohmy.ai) | `zro install omp` | Power-user terminal agent |
| [OpenCode](https://opencode.ai) | `zro install opencode` | Open-source coding agent |
| [Grok Build](https://x.ai) | `zro install grok` | xAI's coding agent |
| [Hermes](https://hermes-agent.nousresearch.com) | `zro install hermes` | Nous Research's agent |
| [OpenClaw](https://github.com/openclaw/openclaw) | `zro install openclaw` | Personal AI assistant |
| [Pi](https://github.com/earendil-works/pi) | `zro install pi` | Minimal coding agent |
| [Prime Agent](https://primeintellect.ai) | `zro install prime` | Prime Intellect's self-improving RLM agent |

Each adapter launches the installed tool as a child process with isolated, Zro-owned
configuration. Session files are temporary; Codex App uses a persistent Zro-owned home.
Pass native tool arguments after `--` (for example `zro oc -- --help`). The last
tool/model pair is remembered and reopened with `zro again`.

---

## Usage

```bash
zro                         # interactive agent picker
zro claude                  # open directly on the default model
zro codex -m glm-5.2        # choose a model for this session
zro omp -m glm-5.2          # launch Oh My Pi through Zro
zro kilo -m glm-5.2         # launch Kilo Code through Zro
zro oc -- --help            # short aliases + native tool arguments
zro again                   # reopen the last tool/model pair
zro models                  # readable model catalog
zro install claude@2.1.105  # pin an agent version
zro feedback                # send feedback to the Zro team
zro claude --dry-run        # secret-safe session preview
zro codex --json            # machine-readable preview
```

---

## Pricing

Plans are spend-based with expected usage, so actual totals vary by model mix, prompt
shape, output length, and cache reads. [See the live pricing page](https://zro.moonmath.ai/pricing).

| Plan | Per month | Yearly | Expected usage |
| --- | --- | --- | --- |
| **Pro** | $20 | $16/mo | ~1B tokens |
| **Max** | $60 | $48/mo | ~5B tokens |

- Usage packs are available with or without a subscription and expire after 90 days.
- Monthly spend resets on the same calendar cadence for monthly and yearly subscribers.
- There are no prorated refunds on cancellation; access stays active to the end of the period.

---

## Safety

- Normal agent configs are never edited.
- Temporary session files live under `~/.cache/zro/sessions` and are removed when the agent exits.
- Kilo Code and Oh My Pi run with a temporary home and XDG profile; only sanitized
  preferences and safe assets are copied in. Provider credentials, MCP definitions, sessions,
  databases, dependency trees, and secret files stay outside the profile.
- Kilo and Oh My Pi telemetry, OTLP export, automatic updates, sharing, and remote control are
  disabled; model and MCP requests still go to the configured Zro endpoints.
- API keys are masked in human and JSON previews. `--dry-run` writes nothing and starts nothing.
- macOS and Linux are supported; use WSL on Windows.

See [SECURITY.md](SECURITY.md) for the security model and private vulnerability reporting.

---

## Contributing

Zro is a small, dependency-light TypeScript CLI (runtime deps: `json5` and `yaml`). Bug
reports, feature requests, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

Zro is licensed under the [MIT License](LICENSE).