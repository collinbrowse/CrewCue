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

## Recent (2026-05-17): Critical correctness fix — first aid station distance preservation (**merged** PR [#281](https://github.com/collinbrowse/CrewCue/pull/281) → `main`)

- **Cause:** PR #271’s projection repair always forced the first checkpoint to mile 0, even when an uploaded GPX/KML/JSON course had aid-station waypoints but no explicit Start waypoint. That silently saved “Aid Station 1” as the race start distance.
- **Fix:** `checkpointsWithProjectedDistances` now anchors the first checkpoint to 0 only when the checkpoint is colocated with the route start; loop finish anchoring also requires the first checkpoint to be the route start and the last checkpoint to be at the route end.
- **Validation:** `npm test -w @crewcue/map-core` and root `npm run verify` green (merge `ad02bc7` on `main`).


## Session status snapshot

- Last updated: 2026-05-19 (UTC)
- **#275 / #282:** Merged to **`main`** via **PR [#282](https://github.com/collinbrowse/CrewCue/pull/282)** (merge `80e3843`). **Closes** [#276](https://github.com/collinbrowse/CrewCue/issues/276)–[#279](https://github.com/collinbrowse/CrewCue/issues/279). Local/remote **`feature/platform-actions-notices`** deleted. **Staging:** `db:migrate` through `0012`.
- **Critical correctness audit:** **#281** merged (`ad02bc7`); map-core first-checkpoint anchoring on `main`.

## Current objective

Daily high-severity correctness audit completed with a narrowly scoped mobile/API correctness fix for route-aligned race tracking and manual stop authority.
Daily high-severity correctness audit completed with a narrowly scoped map-core fix for repeated non-start aid waypoint distance corruption.
Platform actions/notices/idempotency epic delivered on `main` (#282). Next: staging migration soak (`0010`–`0012`) and device smoke for notices + idempotent course save; continue parallel tracks (chat E2E, map/Pace work).

## Next 1-3 tasks

1. Monitor CI/PR for `cursor/critical-correctness-bugs-3cc1`; merge only after checks stay green.
2. Decide product/admin model for `POST /race-rooms/:roomId/entitlement` before hardening the documented manual billing path.
3. Open a separate scoped issue/PR if fixing chat prefetch stale-session cancellation.

## Validation summary

- `npm run test -w @crewcue/map-core` — **pass**.
- `npm run lint -w @crewcue/mobile` — **pass**.
- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/raceRoomProjection.test.js` — **pass** (10/10).
- `npm run verify` — **pass**.
1. Review/merge PR for **`cursor/critical-correctness-bugs-b054`** after CI stays green; this protects single-waypoint repeated-aid imports from being saved as start/finish.
2. Continue post-#271 staging validation: deploy/re-import Telluride JSON and confirm first Bridal ~4–5 mi, second ~34 mi.
3. Open separate scoped issues for mobile map polyline mismatch and chat prefetch stale-session cancellation if still desired.

## Validation summary

- **2026-05-16 critical audit:** `npm test -w @crewcue/map-core` — **pass** (33/33); root **`npm run verify`** — **pass**.
1. Review PR [#281](https://github.com/collinbrowse/CrewCue/pull/281); the PR body includes the bug scenario, impact, root cause, fix, and validation.
2. Monitor CI; merge only after `checks`/`dual-client-guard` stay green.
3. After merge/deploy, re-save any affected imported courses whose first checkpoint was incorrectly persisted at mile 0.

## Validation summary

- `npm test -w @crewcue/map-core` — **pass** (33/33) after first-aid checkpoint regression test.
- `npm run verify` — **pass** (includes mobile Expo export and web/API builds).
- **TMR / map-core (this session):** `npm test -w @crewcue/map-core` — **pass** (32/32); root **`npm run verify`** — **pass** after encounter-hint projection + upload UX.
- `npm run build -w @crewcue/contracts && npm run build -w @crewcue/map-core && npm run build -w @crewcue/api && node --test services/api/dist/services/api/src/routes/raceRooms.entitlement.test.js services/api/dist/services/api/src/routes/raceRoomTasks.test.js services/api/dist/services/api/src/routes/raceRooms.test.js` — **pass** (21/21).
- `npm run test:memory -w @crewcue/api` — **pass** (98/98).
- `npm run verify` — **pass**.
- **#264** merged to `main` (`a041ad0`); run **`npm run verify`** after `git pull` for CI parity; rebuild mobile dev clients (native alignment + lazysodium).
- **#254** merged to `main` (`5b1a791`); run **`npm run verify`** after `git pull` for CI parity.

## Open risks/blockers/questions

- Existing dependency audit warnings surfaced during `npm ci`; no dependency changes were made.
- `POST /race-rooms/:roomId/entitlement` remains a documented/manual billing path exposed to privileged room roles; hardening needs a product/admin/payment decision.
- Remaining audit lead (chat stale prefetch) was not changed in this PR to keep the critical fix narrow.
- Existing courses already saved with a non-start first checkpoint at mile 0 need a course re-save/re-import after this fix; the code change prevents new silent corruption but does not migrate persisted rooms.
- `npm ci` reports existing dependency audit warnings (22 vulnerabilities, including 2 critical); no dependency changes were made.
- Remaining audit leads (mobile map polyline mismatch, chat stale prefetch) were not changed in this audit to keep the critical fix narrow.
- Real APNS / FCM transports are not yet wired; staging push uses the logging transport. The encrypted preview is already piped through, so flipping in real credentials is a localized change.
- The `CrewCueChatNativeBridge` Expo Module does not exist yet; until it's shipped, push previews fall back to `New Message in Crew Chat`. The chat itself works fully and the cipher / payload layout is pinned so the module can be added without breaking changes.
- App-reinstall recovery flow: a device that loses its keypair must be re-enveloped from another device. Documented in the plan's Risks section; UX work tracked in a follow-up issue.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`). All chat endpoints go through `api.*` helpers.
- Server never sees plaintext. Cipher: tweetnacl `secretbox` (XSalsa20-Poly1305). Any future cipher change requires updating JS, iOS NSE, Android FCM in lock-step.
- Native key sync is best-effort via `nativeKeyBridge` — failures must never throw on the JS path.
- Retention is destructive by design; client/server banner copy must remain in sync (`apps/mobile/src/features/chat/retention.ts` ↔ `services/api/src/lib/chatRetention.ts`).

## Successor prompt

```text
Review PR for cursor/critical-correctness-bugs-3cc1; verify CI. If continuing bug audit, separately evaluate the manual entitlement admin/payment model and chat prefetch stale-session cancellation.
On main (post-#268, merge a9e67dd): git pull; npm run verify. Rebuild Android/iOS dev clients after native dependency pulls. Chat follow-ups: CrewCueChatNativeBridge + production push/retention (#236–#238).
Review/merge cursor/critical-correctness-bugs-b054 after CI: map-core now only anchors first/last checkpoints when the first checkpoint is at route start, preserving repeated non-start aid miles. Then continue #271 staging validation/re-import and track separate map polyline mismatch / chat stale-prefetch issues if desired.
Review PR #281 / branch cursor/critical-correctness-bugs-93fb: verify the first-checkpoint anchoring fix for uploads without explicit Start waypoints and merge only after CI is green.
Post-merge, re-save/re-import any affected courses whose first aid station was persisted at mile 0.
```
