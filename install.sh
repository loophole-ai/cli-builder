#!/usr/bin/env bash
set -euo pipefail

APP=loophole
SOURCE_APP=loophole
INSTALL_DIR="${LOOPHOLE_INSTALL_DIR:-$HOME/.loophole/bin}"

MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m'

usage() {
    cat <<EOF
Loophole Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g. 1.0.5)
    -b, --binary <path>     Install from a local binary instead of downloading
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://github.com/loophole-ai/cli/releases/latest/download/install.sh | bash
    curl -fsSL https://raw.githubusercontent.com/loophole-ai/forge/main/install.sh | bash
    curl -fsSL .../install.sh | bash -s -- --version 1.0.5
    ./install.sh --binary /path/to/loophole
EOF
}

requested_version="${LOOPHOLE_VERSION:-}"
no_modify_path=false
binary_path=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -n "${2:-}" ]]; then
                requested_version="$2"
                shift 2
            else
                echo -e "${RED}Error: --version requires a version argument${NC}"
                exit 1
            fi
            ;;
        -b|--binary)
            if [[ -n "${2:-}" ]]; then
                binary_path="$2"
                shift 2
            else
                echo -e "${RED}Error: --binary requires a path argument${NC}"
                exit 1
            fi
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${ORANGE}Warning: Unknown option '$1'${NC}" >&2
            shift
            ;;
    esac
done

mkdir -p "$INSTALL_DIR"

if [[ -n "$binary_path" ]]; then
    if [[ ! -f "$binary_path" ]]; then
        echo -e "${RED}Error: Binary not found at ${binary_path}${NC}"
        exit 1
    fi
    specific_version="local"
else
    raw_os=$(uname -s)
    os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
    case "$raw_os" in
        Darwin*) os="darwin" ;;
        Linux*) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    esac

    arch=$(uname -m)
    [[ "$arch" == "aarch64" ]] && arch="arm64"
    [[ "$arch" == "x86_64" ]] && arch="x64"

    if [[ "$os" == "darwin" && "$arch" == "x64" ]]; then
        if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" == "1" ]]; then
            arch="arm64"
        fi
    fi

    # Git Bash/MSYS2 run emulated x64 on Windows ARM64, but the host CPU is still ARM.
    if [[ "$os" == "windows" && "$arch" == "x64" ]]; then
        if [[ "$raw_os" == *-ARM64 || "${PROCESSOR_IDENTIFIER:-}" == ARM* ]]; then
            arch="arm64"
        fi
    fi

    case "$os-$arch" in
        linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64|windows-arm64) ;;
        *)
            echo -e "${RED}Unsupported OS/Arch: $os/$arch${NC}"
            exit 1
            ;;
    esac

    is_musl=false
    if [[ "$os" == "linux" ]]; then
        [[ -f /etc/alpine-release ]] && is_musl=true
        if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
            is_musl=true
        fi
    fi

    needs_baseline=false
    if [[ "$arch" == "x64" ]]; then
        if [[ "$os" == "linux" ]] && ! grep -qwi avx2 /proc/cpuinfo 2>/dev/null; then
            needs_baseline=true
        fi
        if [[ "$os" == "darwin" && "$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)" != "1" ]]; then
            needs_baseline=true
        fi
        if [[ "$os" == "windows" ]]; then
            ps='(Add-Type -MemberDefinition "[DllImport(\"kernel32.dll\")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
            out=""
            if command -v powershell.exe >/dev/null 2>&1; then
                out=$(powershell.exe -NoProfile -NonInteractive -Command "$ps" 2>/dev/null || true)
            elif command -v pwsh >/dev/null 2>&1; then
                out=$(pwsh -NoProfile -NonInteractive -Command "$ps" 2>/dev/null || true)
            fi
            out=$(echo "$out" | tr -d '\r' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
            [[ "$out" != "true" && "$out" != "1" ]] && needs_baseline=true
        fi
    fi

    target="$os-$arch"
    [[ "$needs_baseline" == "true" ]] && target="$target-baseline"
    [[ "$is_musl" == "true" ]] && target="$target-musl"

    if ! command -v tar >/dev/null 2>&1; then
        echo -e "${RED}Error: 'tar' is required but not installed.${NC}"
        exit 1
    fi

    if [[ -z "$requested_version" ]]; then
        metadata=$(curl -fsSL "https://registry.npmjs.org/@loophole-ai/cli/latest" || true)
        specific_version=$(printf '%s' "$metadata" | grep -o '"version":"[^"]*"' | head -n 1 | cut -d'"' -f4)
        if [[ -z "$specific_version" ]]; then
            echo -e "${RED}Failed to fetch the latest version from npm${NC}"
            exit 1
        fi
    else
        specific_version="${requested_version#v}"
    fi

    package_name="@loophole-ai/cli-$target"
    filename="cli-$target-$specific_version.tgz"
    url="https://registry.npmjs.org/$package_name/-/$filename"

    http_status=$(curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/$package_name/$specific_version" || true)
    if [[ "$http_status" == "404" ]]; then
        echo -e "${RED}Error: version ${specific_version} is not available for $target${NC}"
        echo -e "${MUTED}Available versions: https://www.npmjs.com/package/$package_name?activeTab=versions${NC}"
        exit 1
    fi
    if [[ "$http_status" != "200" ]]; then
        echo -e "${RED}Failed to fetch package information${NC}"
        exit 1
    fi

    binary_name="$SOURCE_APP"
    [[ "$os" == "windows" ]] && binary_name="$SOURCE_APP.exe"
fi

print_message() {
    local level=$1
    local message=$2
    local color="${NC}"
    [[ "$level" == "error" ]] && color="${RED}"
    echo -e "${color}${message}${NC}"
}

check_version() {
    if command -v "$APP" >/dev/null 2>&1; then
        local installed_version
        installed_version=$("$APP" --version 2>/dev/null || echo "")
        installed_version="${installed_version##* }"
        installed_version="${installed_version#v}"
        print_message info "${MUTED}Installed version: ${NC}$installed_version."
    fi
}

download_and_install() {
    print_message info "\n${MUTED}Installing ${NC}$APP ${MUTED}version: ${NC}$specific_version"
    local tmp_dir="${TMPDIR:-/tmp}/loophole_install_$$"
    mkdir -p "$tmp_dir"
    curl -f -L --progress-bar -o "$tmp_dir/$filename" "$url"
    tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"
    local installed_binary="$APP"
    [[ "$os" == "windows" ]] && installed_binary="$APP.exe"
    mv "$tmp_dir/package/bin/$binary_name" "$INSTALL_DIR/$installed_binary"
    chmod 755 "$INSTALL_DIR/$installed_binary"
    rm -rf "$tmp_dir"
}

install_from_binary() {
    print_message info "\n${MUTED}Installing ${NC}$APP ${MUTED}from: ${NC}$binary_path"
    local installed_binary="$APP"
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) installed_binary="$APP.exe" ;;
    esac
    cp "$binary_path" "$INSTALL_DIR/$installed_binary"
    chmod 755 "$INSTALL_DIR/$installed_binary"
}

install_legacy_shim() {
    local shim_os="${os:-}"
    if [[ -z "$shim_os" ]]; then
        case "$(uname -s)" in
            MINGW*|MSYS*|CYGWIN*) shim_os="windows" ;;
        esac
    fi
    rm -f "$INSTALL_DIR/loophole2" "$INSTALL_DIR/loophole2.exe" "$INSTALL_DIR/loophole2.cmd"
    if [[ "$shim_os" == "windows" ]]; then
        cat > "$INSTALL_DIR/loophole2.cmd" <<'EOF'
@echo off
"%~dp0loophole.exe" %*
exit /b %errorlevel%
EOF
        return
    fi
    cat > "$INSTALL_DIR/loophole2" <<'EOF'
#!/bin/sh
exec "$(dirname "$0")/loophole" "$@"
EOF
    chmod 755 "$INSTALL_DIR/loophole2"
}

if [[ -n "$binary_path" ]]; then
    install_from_binary
else
    check_version
    download_and_install
fi
install_legacy_shim

add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file"; then
        print_message info "Command already exists in $config_file, skipping write."
    elif [[ -w $config_file ]]; then
        echo -e "\n# loophole" >> "$config_file"
        echo "$command" >> "$config_file"
        print_message info "${MUTED}Added ${NC}$INSTALL_DIR ${MUTED}to \$PATH in ${NC}$config_file"
    else
        print_message warning "Manually add the directory to $config_file (or similar):"
        print_message info "  $command"
    fi
}

XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
current_shell=$(basename "${SHELL:-sh}")
case $current_shell in
    fish) config_files="$HOME/.config/fish/config.fish" ;;
    zsh) config_files="${ZDOTDIR:-$HOME}/.zshrc ${ZDOTDIR:-$HOME}/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc $XDG_CONFIG_HOME/zsh/.zshenv" ;;
    bash) config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile" ;;
    ash|sh) config_files="$HOME/.ashrc $HOME/.profile /etc/profile" ;;
    *) config_files="$HOME/.bashrc $HOME/.bash_profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile" ;;
esac

if [[ "$no_modify_path" != "true" ]]; then
    config_file=""
    for file in $config_files; do
        if [[ -f $file ]]; then
            config_file=$file
            break
        fi
    done

    if [[ -z $config_file ]]; then
        print_message warning "No config file found for $current_shell. Add this to your shell config:"
        print_message info "  export PATH=$INSTALL_DIR:\$PATH"
    elif [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        case $current_shell in
            fish) add_to_path "$config_file" "fish_add_path $INSTALL_DIR" ;;
            *) add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH" ;;
        esac
    fi
fi

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "$INSTALL_DIR" >> "$GITHUB_PATH"
    print_message info "Added $INSTALL_DIR to \$GITHUB_PATH"
fi

echo -e ""
echo -e "${MUTED}Loophole installed to${NC} $INSTALL_DIR/loophole"
echo -e ""
if [[ -z "$binary_path" ]]; then
    echo -e "${MUTED}To get started, open a new terminal and run:${NC}"
    echo -e "  loophole"
else
    echo -e "${MUTED}Open a new terminal and run the installed binary.${NC}"
fi
echo -e ""
echo -e "${MUTED}Docs:${NC} https://github.com/loophole-ai/loophole-app"
echo -e ""
