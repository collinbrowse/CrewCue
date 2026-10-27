---
description: Native iOS and Android stay in sync through behavior checklists, not by copying UI
paths:
  - "apps/ios/**"
  - "apps/android/**"
  - "packages/client-core/**"
  - "clients/behavior/**"
---

# Native client split

- One PR may change `apps/ios`, `apps/android`, and `packages/client-core` together.
- A checklist-only change may touch `clients/behavior/**` and the harness.
- Implement the checklist in `clients/behavior/<id>.md`. Do not open the other platform's UI to copy layout.
- Shared behavior goes in `packages/client-core` (Swift, no SwiftUI). Structure: `client-core-architecture.md`, `ios-presentation.md`, `android-presentation.md`. Load only the trees the task touches.
- MapLibre, Stream, and Auth0 stay in the platform app.
- Expo is removed. Do not add `apps/mobile`.
- A checklist row may be `pass` only after device proof, not because fixture copy renders.
- iOS proof: `npm run agent:ios:ready -- --deeplink crewcue://dev/<id>`
- Android proof: `npm run agent:android:ready -- --deeplink crewcue://dev/<id>`
