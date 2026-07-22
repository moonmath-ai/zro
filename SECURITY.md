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

Browser login uses a short-lived device code. The CLI generates an ephemeral RSA keypair, and the
website encrypts the issued credential to that public key. The private key remains in CLI memory
and is not written to disk.
