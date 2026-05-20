# Agent handoff source of truth

Use this as the minimal continuity file between sessions.

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `docs/sdlc/mvp-ui-development-spec.md`
5. `docs/sdlc/ui-delivery-roadmap-and-spec.md`
6. `.cursor/rules/github-pr-issue-workflow.mdc`
7. `.github/pull_request_template.md`
8. `docs/sdlc/ios-simulator-agent-qa.md` (when touching `apps/mobile` UI)

## Recent (**merged** PR [#287](https://github.com/collinbrowse/CrewCue/pull/287) → `main`, merge `19aeee3`, **Closes** [#284](https://github.com/collinbrowse/CrewCue/issues/284)): iOS simulator agent QA (XcodeBuildMCP)

- **On `main`:** `.xcodebuildmcp/config.yaml`, `npm run agent:ios:ready`, rule `mobile-simulator-agent-qa`, skill `ios-simulator-agent-qa`, `docs/sdlc/ios-simulator-agent-qa.md`; sim evidence on PR only.
- **Cleanup:** Superseded closed **#285**; deleted branches `chore/ios-simulator-agent-qa`, `chore/xcodebuildmcp-shared-config`, `cursor/regression-test-coverage-9f1d`.

## Recent (**merged** PR [#286](https://github.com/collinbrowse/CrewCue/pull/286) → `main`): API regression — `POST /race-rooms` idempotency

- **Added:** Route tests — same `Idempotency-Key` + body replays `201` and room id; different body → `409`.
- **Validation:** `raceRooms.test.js` 15/15; `npm run test:memory -w @crewcue/api` 106 pass (3 skipped).

## Recent (2026-05-17): Critical correctness fix — first aid station distance preservation (**merged** PR [#281](https://github.com/collinbrowse/CrewCue/pull/281) → `main`)

- **Fix:** `checkpointsWithProjectedDistances` anchors first checkpoint to 0 only when colocated with route start.
- **Validation:** `npm test -w @crewcue/map-core`; `npm run verify` green.

## Session status snapshot

- Last updated: 2026-05-20 (UTC)
- **On `main`:** iOS simulator agent QA **#287** (`19aeee3`); race-room create idempotency tests **#286**; platform actions/notices **#282**; map-core anchoring **#281**.
- **Staging:** `db:migrate` through `0012` before notices + idempotent save soak.

## Current objective

Use **#287** workflow for mobile UI: `npm run agent:ios:ready` + XcodeBuildMCP before marking done. Next coverage slice: **PUT `/course`** and manual-stop idempotency under Postgres retries.

## Next 1-3 tasks

1. Open issue + PR for PUT `/course` / manual-stop idempotency regression tests (Postgres retries).
2. Reduce sim blockers over time (deeplinks, Maestro under `apps/mobile/.maestro/`).
3. Staging soak: `db:migrate` through `0012`, device smoke for notices + idempotent course save.

## Validation summary

- **#287 on `main`:** `npm run agent:ios:ready` smoke OK on macOS; no app code in that PR.
- **#286 on `main`:** API memory tests green (see Recent #286).

## Open risks/blockers/questions

- Auth0 login in sim remains a human blocker until test entry is automated.
- Courses saved with wrong first-checkpoint mile 0 need re-save after **#281**.
- Chat stale prefetch and mobile map polyline mismatch — separate tracks.

## Guardrails

- Mobile UI: rule `mobile-simulator-agent-qa`; evidence on PR only (not `docs/`).
- HTTP centralized per dual-client guard; server source of truth for idempotent outcomes.
- Chat: server never sees plaintext.

## Successor prompt

```text
On main: for mobile UI work follow docs/sdlc/ios-simulator-agent-qa.md (agent:ios:ready + XcodeBuildMCP, PR-only evidence). Next: Postgres idempotency tests for PUT /course and manual-stop.
```
