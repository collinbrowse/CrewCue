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

## Active (2026-05-20): iOS simulator agent QA (**branch `chore/ios-simulator-agent-qa`**, supersedes PR [#285](https://github.com/collinbrowse/CrewCue/pull/285), **Closes** [#284](https://github.com/collinbrowse/CrewCue/issues/284))

- **Added:** `.xcodebuildmcp/config.yaml`, `npm run agent:ios:ready`, rule `mobile-simulator-agent-qa`, skill `ios-simulator-agent-qa`, `docs/sdlc/ios-simulator-agent-qa.md`, PR template sim evidence (PR-only).
- **Policy:** Mobile UI not done without sim proof; human blockers → stop with options.

## Recent (2026-05-20): API regression — `POST /race-rooms` idempotency (PR [#286](https://github.com/collinbrowse/CrewCue/pull/286), branch `cursor/regression-test-coverage-9f1d`)

- **Added:** Injected route tests prove the same `Idempotency-Key` + body replays the original `201` and room id; reusing the key with a different body returns `409`.
- **Fix on branch:** Resolved `main` merge conflict in `courseMetrics.ts` (`isCheckpointAtRouteStart` call site after #281).
- **Validation:** `raceRooms.test.js` 15/15; `npm run test:memory -w @crewcue/api` 106 pass (3 skipped); `npm run verify` green.

## Recent (2026-05-17): Critical correctness fix — first aid station distance preservation (**merged** PR [#281](https://github.com/collinbrowse/CrewCue/pull/281) → `main`)

- **Cause:** PR #271’s projection repair always forced the first checkpoint to mile 0, even when an uploaded GPX/KML/JSON course had aid-station waypoints but no explicit Start waypoint. That silently saved “Aid Station 1” as the race start distance.
- **Fix:** `checkpointsWithProjectedDistances` now anchors the first checkpoint to 0 only when the checkpoint is colocated with the route start; loop finish anchoring also requires the first checkpoint to be the route start and the last checkpoint to be at the route end.
- **Validation:** `npm test -w @crewcue/map-core` and root `npm run verify` green (merge `ad02bc7` on `main`).

## Session status snapshot

- Last updated: 2026-05-20 (UTC)
- **On `main`:** Platform actions/notices/HTTP idempotency **#275 / PR #282** (`80e3843`); map-core first-checkpoint anchoring **#281** (`ad02bc7`); cursor skills in-repo **PR #283** (`06fcb5a`).
- **Active PR:** [#286](https://github.com/collinbrowse/CrewCue/pull/286) — regression coverage for race-room create idempotency; resolve `agent-handoff.md` conflict with `main`, then merge when checks green.
- **Staging:** `db:migrate` through `0012` before notices + idempotent save soak.

## Current objective

Regression coverage hardening after the platform epic on `main`. PR #286 adds deterministic API tests only (no production behavior change). Next: merge #286, then scan **PUT `/course`** and manual-stop idempotency under Postgres retries.

## Next 1-3 tasks

1. Finish merge of `main` into `cursor/regression-test-coverage-9f1d` (handoff resolved); push and confirm PR #286 checks green.
2. Link a tracking issue on #286 if merge policy requires `Closes #...` in the PR body.
3. Staging soak: `db:migrate` through `0012`, device smoke for notices + idempotent course save; continue map/Pace and chat E2E tracks separately.

## Validation summary

- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/raceRooms.test.js` — **pass** (15/15).
- `npm run test:memory -w @crewcue/api` — **pass** (106 pass, 3 skipped).
- `npm run verify` — **pass** on PR branch after `courseMetrics.ts` merge fix.

## Open risks/blockers/questions

- `POST /race-rooms/:roomId/entitlement` remains a manual billing path; hardening needs product/admin decision.
- Courses saved with a non-start first checkpoint at mile 0 need re-save/re-import after **#281**; code prevents new corruption only.
- Chat stale prefetch and mobile map polyline mismatch remain separate audit leads.
- PR #286: no GitHub issue linked yet if policy requires one; dependency audit warnings pre-existing.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Server is source of truth for race room creation and idempotent mutation outcomes; do not alter idempotency persistence/migrations in test-only PRs.
- Chat: server never sees plaintext; cipher changes need JS + native lock-step.

## Successor prompt

```text
Merge chore/ios-simulator-agent-qa PR (Closes #284); close superseded #285. Mobile UI tasks: npm run agent:ios:ready + XcodeBuildMCP; evidence on PR only.
```
