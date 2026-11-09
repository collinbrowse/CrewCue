---
description: Android emulator QA before completing Android UI work
paths:
  - "apps/android/**"
---

# Android emulator agent QA

Applies when changing `apps/android/**`.

## Your own emulator

Parallel agents each run their own read-only instance of the AVD on a port derived from the worktree (`npm run agent:device` prints the serial, for example `emulator-5558`). `npm run agent:android:ready` boots it and `npm run test:android` targets it. Pass `-s <serial>` to every `adb` call. Never use or kill another serial. Every instance must be read-only: one started without `-read-only` blocks all the others.

## Done means

1. `npm run verify:client-behavior` when the checklist changed, and
2. `npm run agent:android:ready -- --deeplink crewcue://dev/<id>` on a booted emulator.

The debug APK is the Compose app.

## Evidence

Put the pass or the blocker in the PR. Do not commit dumps under `docs/`. Ephemeral files stay in `.agent-pr-evidence/`.

## Human blocker

Stop if the emulator needs a human-only step (Play signing, Auth0 dashboard, a missing AVD). Report what was verified and the options to proceed.
