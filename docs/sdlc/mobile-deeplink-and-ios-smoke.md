# Mobile Deep Links and iOS Smoke

This document covers route-level deep links in the mobile app and the local iOS simulator smoke script.

## Deep-link routes

The app scheme is `crewcue` (`apps/mobile/app.json`), and navigation linking maps the routes below:

- `crewcue://guest`
- `crewcue://operate`
- `crewcue://operate/status`
- `crewcue://operate/outbox`
- `crewcue://readouts`
- `crewcue://readouts/incidents`

## Local smoke command (macOS)

Run from repo root:

`npm run smoke:mobile:ios`

The script (`scripts/mobile-ios-deeplink-smoke.mjs`) will:

1. Check `xcrun` is available.
2. Reuse a booted iOS simulator, or boot an available iPhone simulator.
3. Open each deep-link URL with `xcrun simctl openurl`.
4. Exit non-zero if simulator tooling is unavailable or route-open fails.

## Prerequisites

- macOS host with Xcode command line tools installed.
- At least one iOS simulator runtime/device installed.
- The app running in simulator (Expo dev client / Expo Go) so links resolve to visible screens.

## Troubleshooting

- `xcrun not found`: run `xcode-select --install`.
- `No available iOS simulator device found`: install an iOS simulator runtime in Xcode.
- Links open but no route changes: confirm app scheme/linking config (`apps/mobile/src/navigation/linking.ts`) and app is foregrounded.

## Notes on CI

`smoke:mobile:ios` is intentionally local-only. Linux CI cannot run iOS simulators, so CI keeps platform-agnostic checks (`lint`, `typecheck`, `test`, `build`, and startup smoke).
