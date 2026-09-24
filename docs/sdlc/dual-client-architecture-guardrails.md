# Dual-client architecture guardrails (iOS + Android)

**Audience:** engineers and AI agents shipping CrewCue's two native clients.  
**Intent:** keep domain and API behavior client-agnostic, and keep shared client behavior in Swift.

## 1) Target architecture

- `apps/ios` — SwiftUI. An iOS developer should be able to read it as plain SwiftUI.
- `apps/android` — Jetpack Compose / Kotlin. Kotlin stays in this module.
- `packages/client-core` — Swift package. No UI. Android calls it through the Swift 6.3+ Android SDK and the swift-java JNI facade.
- `apps/mobile` — frozen Expo client until `clients/behavior/deeplinks.json` records a pass for every feature on both native apps.
- `apps/web` — removed. There is no replacement web UI.
- Server platform, unchanged:
  - `packages/contracts` — canonical wire shapes
  - `services/api` — domain rules, authz, persistence, pacing, GPX
  - `packages/map-core` — server-side geodesic helpers. Clients do not link it.

Parity is the behavior checklist in `clients/behavior/`, plus each platform's device gate. It is not a screenshot diff and not a line-by-line UI port.

## 2) Boundaries

1. Server authority stays in `services/api`. Clients do not reimplement pacing or GPX parsing.
2. Wire types are generated from `packages/contracts` into Swift and Kotlin. Do not hand-port those structs.
3. Outbox policy, schedule formatting, and other shared client decisions live in `packages/client-core`.
4. MapLibre, Stream, and Auth0 stay native SDK calls in each app. Do not wrap them in a shared UI layer.
5. One issue changes `apps/ios` or `apps/android` or `packages/client-core`, not both UI trees. The checklist issue may touch only `clients/behavior/`.

## 3) Gates

- `npm run verify:client-behavior`
- `npm run verify:client-boundary`
- `npm run verify:client-codegen`
- `npm run verify:client-core` and `npm run verify:client-core:android-build`
- `npm run agent:ios:ready -- --deeplink crewcue://dev/<id>`
- `npm run agent:android:ready -- --deeplink crewcue://dev/<id>`
- `npm run verify:expo-freeze` while `apps/mobile` still exists

A feature that has both UI issues is covered when both device gates have passed. Linux CI does not boot a simulator or emulator.
