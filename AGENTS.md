# AGENTS.md

## Fast path (default)

Implement → scoped `verify:*` mid-slice → full `npm run verify` pre-PR. Skip issue creation, handoff edits, and SDLC doc packs unless multi-session, cloud/staging, `agent-ready`, or the user asks for continuity.

**PRs:** `--body` must be a filled `.github/pull_request_template.md`. Do not use a Summary-only PR recipe — CI `pr-decision-doc-guard` will fail. See `.cursor/rules/pr-decision-doc-guard.mdc`.

## Machine gates

- Ready: `npm run agent:issue:ready -- <n>`
- Done: `npm run agent:pr:done -- <pr>` (includes `pr-decision-doc-guard`)
- iOS: `npm run agent:ios:ready` (SwiftUI, Auth0-free: `--deeplink crewcue://dev/pace-estimate`)
- Android: `npm run agent:android:ready` (Compose emulator, same deeplink family)

## Product invariant: runner progress

Race progress (mile, % complete, next aid, ETA, on-track, avg pace, elevation remaining, last ping) must come from the **runner's phone**: the athlete's location pings, read from the API. Every crew member sees the same progress. A crew phone's own GPS must never drive these readouts.

Source: `GET /race-rooms/:roomId/pings/latest` → client-core `RaceDayAPI.latestPing` → `RunnerProgress` → `RaceDayReadouts.make(runner:)`. "Last ping" is the ping's `recordedAt`.

## When to load more

- **iOS UI** (`apps/ios/**`): `.cursor/rules/mobile-simulator-agent-qa.mdc` + skill `.cursor/skills/ios-simulator-agent-qa/SKILL.md`. Simulator proof on the PR before claiming done.
- **Android UI** (`apps/android/**`): `.cursor/rules/android-emulator-agent-qa.mdc`. Emulator proof on the PR before claiming done.
- **Shared client behavior** (`packages/client-core/**`): Swift tests on the host and the Android SDK build when the SDK is installed. No UI in that package. Structure: `.cursor/rules/client-core-architecture.mdc`.
- **Client structure:** load only the trees the task touches. `packages/client-core/**` → `client-core-architecture.mdc`. `apps/ios/**` → that rule plus `ios-presentation.mdc`. `apps/android/**` → that rule plus `android-presentation.mdc`.
- **Checklists** (`clients/behavior/**`): source of truth for parity. Do not sync by reading the other platform's UI. `deeplinks.json` `pass` is legal only with a device proof file; fixture copy is not a pass.
- **Expo removed.** Native clients are `apps/ios` and `apps/android`. Do not add `apps/mobile`. Native race-day is unfinished while checklist rows are `fail`.
- **XcodeBuildMCP:** Use the installed XcodeBuildMCP skill/docs before calling MCP tools.
- **agent-ready waves:** `.cursor/rules/agent-work-package-verification.mdc` (Ready script first).
- **Handoff / staging:** pull matching `.cursor/rules/*.mdc` by description when needed.
- **Continuity snapshot:** `docs/sdlc/agent-handoff.md` (integration agent / PR-wave boundaries; feature agents: PR Handoff delta only).
