#!/bin/sh
# Install the zro CLI from a GitHub release.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/moonmath-ai/zro/main/scripts/install.sh | sh
#   sh install.sh                 # latest release
#   sh install.sh --version 0.2.2 # specific release
#   sh install.sh --dir ~/bin     # custom install dir (default: /usr/local/bin or ~/.local/bin)
#
# Supports macOS (arm64, x86_64) and Linux (x86_64, arm64). On Windows, run
# this inside WSL.
set -eu

REPO="${ZRO_INSTALL_REPO:-moonmath-ai/zro}"
VERSION=""
INSTALL_DIR=""
BASE_URL="https://github.com/${REPO}/releases/download"

say() { printf '%s\n' "$*" >&2; }
die() { say "error: $*"; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2#v}"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; VERSION="${VERSION#v}"; shift ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    -h|--help) say "usage: install.sh [--version X.Y.Z] [--dir PATH]"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }
need uname
need curl

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) os_part="darwin" ;;
  Linux) os_part="linux" ;;
  *) die "unsupported OS: $OS (on Windows, run this inside WSL)" ;;
esac

case "$ARCH" in
  arm64|aarch64) arch_part="arm64" ;;
  x86_64|amd64) arch_part="x64" ;;
  *) die "unsupported architecture: $ARCH" ;;
esac

TARGET="${os_part}-${arch_part}"
ARTIFACT="zro-${TARGET}"

if [ -z "$VERSION" ]; then
  say "Resolving latest release of ${REPO}…"
  VERSION="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
    "https://github.com/${REPO}/releases/latest" | sed 's/.*\/tag\/v//')"
  [ -n "$VERSION" ] || die "could not determine latest release"
fi
say "Installing zro v${VERSION} for ${TARGET}"

TAG="v${VERSION}"
DOWNLOAD_URL="${BASE_URL}/${TAG}/${ARTIFACT}"
SUMS_URL="${BASE_URL}/${TAG}/SHA256SUMS"

choose_dir() {
  if [ -n "$INSTALL_DIR" ]; then printf '%s' "$INSTALL_DIR"; return; fi
  if [ -w /usr/local/bin ]; then printf '%s' /usr/local/bin; return; fi
  printf '%s' "${HOME}/.local/bin"
}
DEST_DIR="$(choose_dir)"
DEST="${DEST_DIR}/zro"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Downloading ${DOWNLOAD_URL}"
curl -fsSL -o "${TMP}/${ARTIFACT}" "$DOWNLOAD_URL" \
  || die "download failed (does release ${TAG} contain ${ARTIFACT}?)"

say "Verifying checksum"
curl -fsSL -o "${TMP}/SHA256SUMS" "$SUMS_URL" || die "could not download SHA256SUMS"
EXPECTED="$(awk -v f="$ARTIFACT" '$2 == f { print $1 }' "${TMP}/SHA256SUMS")"
[ -n "$EXPECTED" ] || die "no checksum entry for ${ARTIFACT} in SHA256SUMS"

if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "${TMP}/${ARTIFACT}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "${TMP}/${ARTIFACT}" | awk '{print $1}')"
else
  die "missing checksum tool: need shasum or sha256sum"
fi

[ "$ACTUAL" = "$EXPECTED" ] || die "checksum mismatch for ${ARTIFACT}
  expected: ${EXPECTED}
  actual:   ${ACTUAL}"

mkdir -p "$DEST_DIR" 2>/dev/null || die "cannot create $DEST_DIR (try --dir or sudo)"
chmod 755 "${TMP}/${ARTIFACT}"

if [ -w "$DEST_DIR" ]; then
  mv "${TMP}/${ARTIFACT}" "$DEST"
else
  say "Need elevated permissions to write ${DEST_DIR}"
  sudo -v || die "sudo required"
  sudo mv "${TMP}/${ARTIFACT}" "$DEST"
  sudo chmod 755 "$DEST"
fi

say "Installed $("$DEST" --help >/dev/null 2>&1 && echo "zro") to ${DEST}"

case ":${PATH}:" in
  *":${DEST_DIR}:"*) ;;
  *)
    say ""
    say "Add ${DEST_DIR} to your PATH, e.g.:"
    say "  export PATH=\"${DEST_DIR}:\$PATH\""
    ;;
esac

say ""
say "Run 'zro --help' to get started."
