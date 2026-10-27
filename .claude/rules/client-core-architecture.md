---
description: Shared client architecture for client-core, used by iOS and Android
paths:
  - "packages/client-core/**"
  - "apps/ios/**"
  - "apps/android/**"
---

# Client-core architecture

Server domain stays in `services/api`. Generated wire types stay generated. `packages/client-core` stores, syncs, and maps. It does not reimplement pacing or GPX. MapLibre, Stream, and Auth0 stay in each app.

New shared behavior is a Swift type plus a Swift test. Android calls it through `CFacade.swift` and `ClientCoreBridge.kt`. Kotlin does not grow a second outbox, formatter, or HTTP stack.

A bugfix inside an existing fixture view does not restructure the shell. The first task that adds client policy or a screen with behavior creates the files below, then uses them.

## Seams

- `Logging.swift`: `Logger` protocol. No `OSLog` in this package. `URLSession.shared` stays only inside the existing `URLSessionTransport`.
- `UserFacingError.swift`: code, message, retryable. Map `ClientHTTPError` into it. Platform SDK failures map into it in the app.
- `Route.swift`: parse `crewcue://dev/<id>` and query state. Apps do not invent route ids.
- `ClientGraph.swift`: struct of protocols (transport, clock, logger, and a repository only when a task persists or syncs). Apps construct it. No stateful singletons. Pure enum namespaces (`ScheduleFormat`, `OutboxPolicy`, `APIClient`) stay.
- Repositories live next to the policy they wrap. They map generated wire models to client types at the edge. They do not copy server rules.
- Screen state stays an enum. Extend `FeatureState` with loading or submitting only when a flow needs them. New states need a checklist row and a Swift test.
- New Swift is strict-concurrency and `Sendable`. Language mode matches the Swift 6.3 Android SDK in `docs/sdlc/dual-client-architecture-guardrails.md`. Do not add Swift 5-only constructs.
- Grow the C facade only when Android must call a new function.
- SOLID is a review lens, not a folder tree. Do not edit `Generated/`.

## Gates

For `packages/client-core/**` changes, run `npm run verify:client-core` and `npm run verify:client-boundary`.
