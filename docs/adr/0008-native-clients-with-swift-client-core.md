# ADR 0008: Native iOS and Android clients with a shared Swift client core

- Status: Approved
- Date: 2026-10-13
- Supersedes: [ADR 0001](./0001-hybrid-mobile-framework.md)

## Context

The Expo app (`apps/mobile`) reached about 28k lines. Map, chat, and background-location work kept hitting the limits of the React Native bridge and community modules. UI polish lagged behind platform-native apps. Agents were also maintaining two mental models: the Expo tree and the native experiments.

## Decision

- `apps/ios`: SwiftUI.
- `apps/android`: Jetpack Compose.
- `packages/client-core`: a Swift package with no UI. It holds shared client behavior: routes, outbox policy, formatting, the API client, and user-facing errors. iOS links it directly. Android calls it through the Swift Android SDK and a C/JNI facade (`CFacade.swift` → `ClientCoreBridge.kt`).
- Wire types are generated from `packages/contracts` (`npm run verify:client-codegen`).
- Parity between platforms is defined by `clients/behavior/*.md` checklists, not by copying UI.
- `apps/mobile` and `apps/web` are deleted.

## Consequences

- Each platform gets native UI, accessibility, and SDKs (MapKit/MapLibre, Auth0, Stream) without a bridge.
- Shared logic is written once, in Swift. Kotlin must not grow a second outbox, HTTP stack, or formatter.
- The Android build depends on the Swift Android SDK toolchain (pinned in CI).
- Feature parity with the deleted Expo app has to be rebuilt feature by feature, using the checklists.
