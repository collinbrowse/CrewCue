# Mobile Deep Links, iOS Smoke, and Android Smoke

This document covers route-level deep links in the mobile app and local smoke scripts for iOS simulator and Android devices/emulators.

## Deep-link routes

The app scheme is `crewcue` (`apps/mobile/app.json`), and navigation linking maps the routes below:

- `crewcue://guest`
- `crewcue://operate`
- `crewcue://operate/status`
- `crewcue://operate/outbox`
- `crewcue://readouts`
- `crewcue://readouts/incidents`

## Local smoke commands

Run from repo root:

`npm run smoke:mobile:android`
`npm run smoke:mobile:ios`

### Android (`smoke:mobile:android`)

The script (`scripts/mobile-android-deeplink-smoke.mjs`) will:

1. Check `adb` is available.
2. Pick the first connected Android device/emulator from `adb devices`.
3. Open each deep-link URL with `adb shell am start -a android.intent.action.VIEW -d ...`.
4. Exit non-zero if Android tooling/device is unavailable or route-open fails.

### iOS (`smoke:mobile:ios`)

The script (`scripts/mobile-ios-deeplink-smoke.mjs`) will:

1. Check `xcrun` is available.
2. Reuse a booted iOS simulator, or boot an available iPhone simulator.
3. Open each deep-link URL with `xcrun simctl openurl`.
4. Exit non-zero if simulator tooling is unavailable or route-open fails.

## Prerequisites

- Deep-link route smoke is local-only and intended for manual validation while the app is running.
- The app running in simulator/emulator/device (Expo dev client / Expo Go) so links resolve to visible screens.

### Android

- Android platform tools installed (`adb` on `PATH`).
- At least one connected Android emulator/device in `device` state (`adb devices`).

### iOS

- macOS host with Xcode command line tools installed.
- At least one iOS simulator runtime/device installed.

## Troubleshooting

- `adb not found`: install Android platform tools and ensure `adb` is on your `PATH`.
- `No connected Android device/emulator found`: boot an emulator or connect a device, then confirm with `adb devices`.
- `xcrun not found`: run `xcode-select --install`.
- `No available iOS simulator device found`: install an iOS simulator runtime in Xcode.
- Links open but no route changes: confirm app scheme/linking config (`apps/mobile/src/navigation/linking.ts`) and app is foregrounded.

## Notes on CI

`smoke:mobile:ios` and `smoke:mobile:android` are intentionally local-only. CI keeps platform-agnostic checks (`lint`, `typecheck`, `test`, `build`, and startup smoke).
