# Changelog

Notable product changes in zro. This is for people following the repo, not a dump of every commit.
GitHub Releases still mark tagged builds.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `zro feedback` — send feedback to the Zro team. Requires login, posts to the Zro backend
  (`/api/cli/feedback`), and supports a positional message, an interactive prompt, and `--json`
  output.
- CI version gate: a PR is rejected unless its `package.json` version exceeds the latest released
  version on npm.

## [0.2.3] - 2026-09-01

### Added

- `zro feedback` command (see [Unreleased]).

### Changed

- Releases are now tag-based (`v*`) and published to npm via the `Publish` workflow.
- CI now enforces that every PR bumps the package version above the latest npm release.