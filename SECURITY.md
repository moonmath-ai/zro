# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Report it privately through
GitHub's security advisory interface for this repository.

Include the affected version, reproduction steps, impact, and any suggested mitigation. We will
acknowledge a complete report as soon as practical and coordinate disclosure after a fix is
available.

## Security model

Zro stores credentials with user-only filesystem permissions and creates isolated configuration
for each launched tool. Normal tool configuration is read only when an adapter needs to preserve
compatible user settings; it is not modified. Temporary session files are removed when the child
process exits.

Kilo Code receives a per-session `HOME` and XDG profile. Its adapter copies only a sanitized subset
of user preferences plus regular files from known agent, command, skill, mode, and plugin asset
directories. It excludes provider and MCP configuration, model overrides, auth/account state,
sessions, databases, caches, dependency manifests and trees, telemetry state, and symbolic links.
The high-precedence generated configuration refers to the credential as `{env:ZRO_API_KEY}` rather
than writing its value to disk.

Oh My Pi also receives a per-session `HOME`, XDG profile, and `PI_CODING_AGENT_DIR`. Its adapter
copies a sanitized subset of display preferences and regular files from known agent, command,
prompt, skill, and theme directories. Auth databases, sessions, caches, dependency trees, secret
files, and symlinks are excluded. Zro supplies the provider key and MCP bearer through child-process
environment variables, disables OTLP export and Auto QA reporting, and forces update, remote-memory,
and remote-compaction controls through a temporary high-precedence settings overlay.

Browser login uses a short-lived device code. The CLI generates an ephemeral RSA keypair, and the
website encrypts the issued credential to that public key. The private key remains in CLI memory
and is not written to disk.
