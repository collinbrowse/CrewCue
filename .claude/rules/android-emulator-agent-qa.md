---
description: Android emulator QA before completing Android UI work
paths:
  - "apps/android/**"
---

# Android emulator agent QA

Applies when changing `apps/android/**`.

## Your own emulator

Parallel agents each run their own read-only instance of the AVD on a port derived from the worktree (`npm run agent:device` prints the serial, for example `emulator-5558`). `npm run agent:android:ready` boots it and `npm run test:android` targets it. Pass `-s <serial>` to every `adb` call. Never use or kill another serial. Every instance must be read-only: one started without `-read-only` blocks all the others.

**One worktree at a time.** A machine-wide lock (`~/.crewcue/android-device.lock`) gives Android to one worktree. `agent:android:ready` takes it, waiting up to 5 minutes, and fails with the holder's name if it never frees; do non-Android work and retry later. When your Android proof is done, run `npm run agent:android:done`: it stops your emulator and frees the turn. A turn left idle for 45 minutes is taken over.

**GPU crashes.** On a busy Mac the host GPU can crash the emulator ("context was preempted", a crashpad dump at startup, or the device dropping mid-install). A failed boot retries once with software rendering by itself. If the emulator dies after booting, run `npm run agent:android:done`, then boot again with `CREWCUE_EMULATOR_GPU=swiftshader_indirect npm run agent:android:ready -- …` (or `--gpu swiftshader_indirect`). It is slower but stable.

## Done means

1. `npm run verify:client-behavior` when the checklist changed, and
2. `npm run agent:android:ready -- --deeplink crewcue://dev/<id>` on a booted emulator.

The debug APK is the Compose app.

## Evidence

Put the pass or the blocker in the PR. Do not commit dumps under `docs/`. Ephemeral files stay in `.agent-pr-evidence/`.

## Human blocker

Stop if the emulator needs a human-only step (Play signing, Auth0 dashboard, a missing AVD). Report what was verified and the options to proceed.
