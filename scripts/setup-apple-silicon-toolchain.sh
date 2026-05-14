#!/usr/bin/env bash
# One-shot: Apple Silicon Homebrew at /opt/homebrew + current Node + CocoaPods.
# Requires: arm64 Mac, curl, and sudo when Homebrew is not yet installed under /opt/homebrew.
set -euo pipefail

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This script is for Apple Silicon (arm64). On Intel, use your Intel Homebrew setup as-is."
  exit 1
fi

echo "==> Checking for /opt/homebrew Homebrew"
if [[ ! -x /opt/homebrew/bin/brew ]]; then
  echo "Apple Silicon Homebrew is not installed."
  echo "Installing to /opt/homebrew (will prompt for your macOS password once)..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo
  echo "Add Homebrew to your PATH for this session (install script prints this too):"
  echo '  eval "$(/opt/homebrew/bin/brew shellenv)"'
  eval "$(/opt/homebrew/bin/brew shellenv)"
else
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

echo "==> Upgrading Homebrew (Apple Silicon)"
brew update

echo "==> Installing / upgrading Node and CocoaPods on Apple Silicon Homebrew"
brew install node cocoapods || brew upgrade node cocoapods

if [[ ! -x /opt/homebrew/bin/node ]]; then
  echo "ERROR: /opt/homebrew/bin/node is still missing after brew install node."
  echo "Fix Homebrew errors above, then run: brew install node"
  exit 1
fi

echo "==> Removing old Intel-prefix Node kegs (only after Apple Silicon Node is present)"
if [[ -x /usr/local/bin/brew ]]; then
  /usr/local/bin/brew uninstall --force --ignore-dependencies node@22 node 2>/dev/null || true
  /usr/local/bin/brew cleanup 2>/dev/null || true
fi

# Xcode / RN script phases read ios/.xcode.env* — a stale .xcode.env.local can pin a deleted Cellar path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
XCODE_ENV_LOCAL="${REPO_ROOT}/apps/mobile/ios/.xcode.env.local"
if [[ -f "${XCODE_ENV_LOCAL}" ]]; then
  if grep -qE '/usr/local/Cellar/node|/usr/local/opt/node' "${XCODE_ENV_LOCAL}" 2>/dev/null; then
    echo "==> Removing stale ${XCODE_ENV_LOCAL} (old NODE_BINARY path)"
    rm -f "${XCODE_ENV_LOCAL}"
  fi
fi

echo
echo "==> Done. Verify (expect arm64 + /opt/homebrew paths):"
echo "    which node && file \"\$(which node)\" && node -p process.arch"
echo "    which pod && pod --version"
echo

if [[ "$(command -v node)" == /usr/local/* ]]; then
  echo "WARNING: \`node\` resolves under /usr/local (Intel Homebrew), not /opt/homebrew."
  echo "  Old Intel node@22 often breaks after brew upgrades (dyld: libsimdjson.*.dylib not found)."
  echo "  Fix: put Apple Silicon brew first in PATH, then open a new terminal:"
  echo "    eval \"\$(/opt/homebrew/bin/brew shellenv)\""
  echo "  Or reinstall the Intel keg you are still using:"
  echo "    /usr/local/bin/brew reinstall node@22"
  echo
fi

echo "Open a NEW terminal tab, then run the lines above."
