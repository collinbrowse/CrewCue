---
description: iOS simulator QA via XcodeBuildMCP before completing mobile UI work
paths:
  - "apps/ios/**"
---

# Mobile simulator agent QA

Applies when changing **`apps/ios/**`** (SwiftUI).

## Your own simulator

Parallel agents each get their own simulator, named `CrewCue <worktree>`. `npm run agent:ios:ready` and `npm run test:ios` create and use it automatically. `npm run agent:device` prints its UDID: pass that UDID as the device or `simulatorId` to every iOS-simulator and XcodeBuildMCP call, because their defaults point at a shared simulator. Never boot, erase or shut down another simulator.

## Done means

1. `npm run verify` (or scoped tests if agreed) **and**
2. Acceptance criteria exercised on a **booted iOS simulator** via XcodeBuildMCP (or Maestro when a flow exists).
3. For a new or reworked screen, proof at more than one size, following `.claude/rules/ios-presentation.md` → Adaptive layout:
   - your standard iPhone simulator
   - an iPhone Duo simulator on both displays: outer (compact width) and inner (regular width)
   - one switch between those displays in the middle of the flow, showing that state was kept

   Name the extra simulator `CrewCue <worktree> Duo`; the ownership rules above apply to it too. If a size can't be run, list it under Blocker in the PR's Device evidence.

Never report a mobile UI task complete without simulator proof.

## Loop

1. `npm run agent:ios:ready -- --deeplink crewcue://dev/hello` — builds and installs the SwiftUI app. Metro is not part of this gate. Prefer a checklist deeplink from `clients/behavior/deeplinks.json`.
2. Skill **ios-simulator-agent-qa**: `snapshot_ui` → act by accessibility label → assert → screenshot on fail/pass.
3. Fail → fix code → re-run harness if needed → repeat (cap **5** sim iterations, then stop with a blocker report).
   Changed the launch path (`CrewCueApp`, `AppRoot`, the splash, the first screen)? One launch can pass by luck. Run `npm run test:ios:launch-loop` on an iOS 27 simulator; its header says how to end the splash over an animating screen.
4. Before Done: `npm run agent:pr:done -- <pr>`.
5. Finished with the simulator: `npm run agent:ios:done` (shuts down yours and its Duo twin, deletes `.xcresult` bundles; `-- --delete` also deletes the simulators).

## Evidence (PR only)

- Put screenshots, `snapshot_ui` excerpts, and pass/fail notes in the **PR description or PR comments**.
- **Do not** commit evidence under `docs/` or permanent repo paths. Ephemeral local files only under `.agent-pr-evidence/` (gitignored).

## Human blocker

Stop (do not claim done) if the sim cannot proceed without human-only steps. Report what blocked, what was verified, and options to proceed.

## Out of scope

- API-only / web-only changes: existing test plans; no iOS sim required.
