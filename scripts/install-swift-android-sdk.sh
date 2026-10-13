#!/usr/bin/env bash
# Install the Swift Android SDK and link an NDK sysroot into the bundle.
# NDK 29+ breaks C/C++ builds (stdlib.h). The 6.3.2 bundle is set up against r27 or r28.
set -euo pipefail

: "${SWIFT_ANDROID_SDK_URL:?}"
: "${SWIFT_ANDROID_SDK_CHECKSUM:?}"

swift sdk install "$SWIFT_ANDROID_SDK_URL" --checksum "$SWIFT_ANDROID_SDK_CHECKSUM"

setup=$(
  find \
    "$HOME/.swiftpm" \
    "$HOME/.local" \
    "$HOME/.config" \
    "$HOME/.cache" \
    "$HOME/Library/org.swift.swiftpm" \
    -name setup-android-sdk.sh -print -quit 2>/dev/null || true
)
if [ -z "$setup" ]; then
  echo "::error::setup-android-sdk.sh not found after installing the Swift Android SDK"
  swift sdk list || true
  exit 1
fi

sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
ndk_root="$sdk_root/ndk"
pick=""
if [ -d "$ndk_root" ]; then
  pick=$(find "$ndk_root" -mindepth 1 -maxdepth 1 -type d -name '27.*' | sort | tail -1 || true)
  if [ -z "$pick" ]; then
    pick=$(find "$ndk_root" -mindepth 1 -maxdepth 1 -type d -name '28.*' | sort | tail -1 || true)
  fi
fi
if [ -z "$pick" ]; then
  echo "::error::Swift Android SDK 6.3.2 needs NDK r27 or r28 under $ndk_root"
  ls -1 "$ndk_root" 2>/dev/null || true
  exit 1
fi

# setup-android-sdk.sh lives at <bundle>/swift-android/scripts/.
swift_sdk_root="$(cd "$(dirname "$setup")/.." && pwd)"
export ANDROID_NDK_HOME="$pick"
export SWIFT_ANDROID_SDK_ROOT="$swift_sdk_root"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "ANDROID_NDK_HOME=$ANDROID_NDK_HOME" >> "$GITHUB_ENV"
  echo "SWIFT_ANDROID_SDK_ROOT=$SWIFT_ANDROID_SDK_ROOT" >> "$GITHUB_ENV"
fi
echo "install-swift-android-sdk: NDK $ANDROID_NDK_HOME"
echo "install-swift-android-sdk: SDK $SWIFT_ANDROID_SDK_ROOT"
echo "install-swift-android-sdk: $setup"
ANDROID_NDK_HOME="$ANDROID_NDK_HOME" bash "$setup"
