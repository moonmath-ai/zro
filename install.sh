#!/bin/bash

set -euo pipefail

# Parse command line arguments
TARGET="${1:-latest}"

if [[ ! "$TARGET" =~ ^(stable|latest|[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?)$ ]]; then
    echo "Usage: $0 [stable|latest|VERSION]" >&2
    exit 1
fi

# Refuse to run under sudo from a regular user's shell. This installer puts
# everything under $HOME, which under sudo typically resolves to root's home:
# the binary lands in /root/.local/bin (or is left root-owned in the user's
# home, depending on the distro's sudo configuration), and the 'zro' command
# is then not found in the user's own shell. Plain root with no sudo
# (containers, CI, root-only systems) is unaffected by this check.
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && [ -z "${ZRO_INSTALL_ALLOW_SUDO:-}" ]; then
    echo "Error: do not run this installer with sudo." >&2
    echo "" >&2
    echo "Zro installs into your home directory and does not need root access." >&2
    echo "With sudo, the installation would go into root's home directory instead of" >&2
    echo "yours, and the 'zro' command would not work from your own shell." >&2
    echo "" >&2
    echo "Please re-run the same command without sudo, e.g.:" >&2
    echo "    curl -fsSL https://zro.moonmath.ai/install.sh | bash" >&2
    echo "" >&2
    echo "To intentionally install Zro for the root user, re-run with" >&2
    echo "ZRO_INSTALL_ALLOW_SUDO=1 set in the installer's environment, e.g.:" >&2
    echo "    curl -fsSL https://zro.moonmath.ai/install.sh | sudo ZRO_INSTALL_ALLOW_SUDO=1 bash" >&2
    exit 1
fi

REPO="moonmath-ai/zro"
if [ "$TARGET" = "stable" ] || [ "$TARGET" = "latest" ]; then
    DOWNLOAD_BASE_URL="https://github.com/${REPO}/releases/latest/download"
else
    DOWNLOAD_BASE_URL="https://github.com/${REPO}/releases/download/v${TARGET}"
fi

DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "Either curl or wget is required but neither is installed" >&2
    exit 1
fi

HAS_JQ=false
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
fi

HAS_ZSTD=false
if command -v zstd >/dev/null 2>&1; then
    HAS_ZSTD=true
fi

download_file() {
    local url="$1"
    local output="${2:-}"

    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            curl -fsSL -o "$output" "$url"
        else
            curl -fsSL "$url"
        fi
    elif [ "$DOWNLOADER" = "wget" ]; then
        if [ -n "$output" ]; then
            wget -q -O "$output" "$url"
        else
            wget -q -O - "$url"
        fi
    else
        return 1
    fi
}

get_checksum_from_manifest() {
    local json="$1"
    local platform="$2"

    json=$(echo "$json" | tr -d '\n\r\t' | sed 's/ \+/ /g')

    if [[ $json =~ \"$platform\"[[:space:]]*:[[:space:]]*[{][^{}]*\"checksum\"[[:space:]]*:[[:space:]]*\"([a-f0-9]{64})\" ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
}

get_size_from_manifest() {
    local json="$1"
    local platform="$2"
    json=$(echo "$json" | tr -d '\n\r\t' | sed 's/ \+/ /g')
    if [[ $json =~ \"$platform\"[[:space:]]*:[[:space:]]*[{][^{}]*\"size\"[[:space:]]*:[[:space:]]*([0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

explain_exit() {
    local install_code="$1"
    if [ "$install_code" -lt 128 ]; then
        return 0
    fi
    if [ -t 0 ]; then
        stty sane 2>/dev/null || true
    fi
    local red="" reset=""
    if [ -t 2 ]; then
        red=$'\033[31m'
        reset=$'\033[0m'
    fi
    if [ "$install_code" -eq 137 ] && [ "$os" = "linux" ]; then
        echo "${red}Installation was killed before it could finish (exit code 137). This usually means the system ran out of memory.${reset}" >&2
        echo "${red}Free up memory, then run this script again.${reset}" >&2
    else
        echo "${red}Installation was killed before it could finish (exit code $install_code).${reset}" >&2
    fi
}

ensure_path() {
    local bin_dir="$1"
    case ":${PATH}:" in
        *":${bin_dir}:"*) return 0 ;;
    esac

    local marker='export PATH="$HOME/.local/bin:$PATH"'
    local rc
    for rc in "${HOME}/.zshrc" "${HOME}/.bashrc"; do
        if [ -f "$rc" ] && ! grep -q '.local/bin' "$rc"; then
            printf '\n# Added by the zro installer\n%s\n' "$marker" >> "$rc"
        fi
    done

    echo ""
    echo "Add ${bin_dir} to your PATH if zro is not found. Open a new terminal, or run:"
    echo "    ${marker}"
}

main() {
    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "Windows is not supported by this script. Install with npm: npm install --global @moonmath-ai/zro" >&2
            exit 1
            ;;
        *)
            echo "Unsupported operating system: $(uname -s)" >&2
            exit 1
            ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac

    if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
        if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = "1" ]; then
            arch="arm64"
        fi
    fi

    if [ "$os" = "linux" ]; then
        if [ -f /lib/libc.musl-x86_64.so.1 ] || [ -f /lib/libc.musl-aarch64.so.1 ] || ldd /bin/ls 2>&1 | grep -q musl; then
            platform="linux-${arch}-musl"
        else
            platform="linux-${arch}"
        fi
    else
        platform="${os}-${arch}"
    fi

    if [ "$platform" = "linux-arm64-musl" ]; then
        echo "Zro has no Alpine arm64 binary. Node.js does not publish an official linux-arm64-musl build." >&2
        echo "Install with Node.js 22 or later: npm install --global @moonmath-ai/zro" >&2
        exit 1
    fi

    # Node.js musl builds link against musl libstdc++/libgcc, which base Alpine lacks.
    if [ "$platform" = "linux-x64-musl" ]; then
        for lib in libstdc++.so.6 libgcc_s.so.1; do
            if [ ! -e "/lib/$lib" ] && [ ! -e "/usr/lib/$lib" ]; then
                echo "Zro's musl build needs $lib, which is not installed." >&2
                echo "On Alpine, run as root: apk add libstdc++ libgcc" >&2
                echo "Then re-run this installer." >&2
                exit 1
            fi
        done
    fi

    if [ "$os" = "darwin" ]; then
        command -v shasum >/dev/null 2>&1 || { echo "shasum is required" >&2; exit 1; }
    else
        command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }
    fi

    checksum_matches() {
        local actual
        if [ "$os" = "darwin" ]; then
            actual=$(shasum -a 256 "$1" | cut -d' ' -f1)
        else
            actual=$(sha256sum "$1" | cut -d' ' -f1)
        fi
        [ "$actual" = "$2" ]
    }

    # Not local: the EXIT trap fires after main returns, when locals are gone.
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT

    local manifest_json
    if ! manifest_json=$(download_file "${DOWNLOAD_BASE_URL}/manifest.json"); then
        echo "Failed to download the release manifest from ${DOWNLOAD_BASE_URL}/manifest.json" >&2
        exit 1
    fi
    if [[ ! "$manifest_json" =~ ^[[:space:]]*\{ ]]; then
        echo "Failed to get a valid release manifest (got unexpected content)." >&2
        exit 1
    fi

    local checksum size
    if [ "$HAS_JQ" = true ]; then
        checksum=$(echo "$manifest_json" | jq -r ".platforms[\"$platform\"].checksum // empty")
        size=$(echo "$manifest_json" | jq -r ".platforms[\"$platform\"].size // empty")
    else
        checksum=$(get_checksum_from_manifest "$manifest_json" "$platform" || true)
        size=$(get_size_from_manifest "$manifest_json" "$platform" || true)
    fi

    if [ -z "$checksum" ] || [[ ! "$checksum" =~ ^[a-f0-9]{64}$ ]]; then
        echo "Platform $platform not found in manifest" >&2
        exit 1
    fi

    local binary_path="${tmp}/zro-${platform}"
    local verified=false
    local zst_checksum=""
    if [ "$HAS_ZSTD" = true ] && [[ "$size" =~ ^[1-9][0-9]*$ ]]; then
        local zst_manifest_json
        zst_manifest_json=$(download_file "${DOWNLOAD_BASE_URL}/manifest.zst.json" 2>/dev/null || true)
        if [ "$HAS_JQ" = true ]; then
            zst_checksum=$(echo "$zst_manifest_json" | jq -r ".platforms[\"$platform\"].checksum // empty" 2>/dev/null || true)
        else
            zst_checksum=$(get_checksum_from_manifest "$zst_manifest_json" "$platform" || true)
        fi
    fi

    if [[ "$zst_checksum" =~ ^[a-f0-9]{64}$ ]]; then
        if download_file "${DOWNLOAD_BASE_URL}/zro-${platform}.zst" "${binary_path}.zst" \
            && checksum_matches "${binary_path}.zst" "$zst_checksum"; then
            set +o pipefail
            zstd -d -q -c "${binary_path}.zst" 2>/dev/null | head -c "$size" > "$binary_path" || true
            set -o pipefail
            if checksum_matches "$binary_path" "$checksum"; then
                verified=true
            fi
        fi
        rm -f "${binary_path}.zst"
    fi

    if [ "$verified" = false ]; then
        if ! download_file "${DOWNLOAD_BASE_URL}/zro-${platform}" "$binary_path"; then
            echo "Download failed" >&2
            rm -f "$binary_path"
            exit 1
        fi
        if ! checksum_matches "$binary_path" "$checksum"; then
            echo "Checksum verification failed" >&2
            rm -f "$binary_path"
            exit 1
        fi
    fi

    local bin_dir="${HOME}/.local/bin"
    local dest="${bin_dir}/zro"
    mkdir -p "$bin_dir"
    cp "$binary_path" "$dest"
    chmod +x "$dest"
    if [ "$os" = "darwin" ]; then
        xattr -d com.apple.quarantine "$dest" 2>/dev/null || true
    fi

    local install_code=0
    local version_line=""
    set +e
    version_line=$("$dest" --version 2>"${tmp}/version.err")
    install_code=$?
    set -e
    if [ "$install_code" -ne 0 ]; then
        explain_exit "$install_code"
        if [ "$install_code" -ge 128 ]; then
            echo "The binary is at ${dest}. Run it again after freeing memory." >&2
        else
            rm -f "$dest"
            echo "The installed binary failed to start." >&2
            if [ -s "${tmp}/version.err" ]; then
                cat "${tmp}/version.err" >&2
            fi
        fi
        exit "$install_code"
    fi

    ensure_path "$bin_dir"

    echo ""
    echo "Installation complete."
    echo ""
    echo "  zro ${version_line}"
    echo "  ${dest}"
    echo ""
    echo "Next:"
    echo "    zro login"
    echo "    zro claude"
    echo ""
}

if [ -z "${ZRO_INSTALL_LIB:-}" ]; then
    main "$@"
fi
