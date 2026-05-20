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

## Recent (**merged** PR [#282](https://github.com/collinbrowse/CrewCue/pull/282) → `main`, merge `80e3843`, **Closes** [#276](https://github.com/collinbrowse/CrewCue/issues/276)–[#279](https://github.com/collinbrowse/CrewCue/issues/279)): Platform actions, notices, HTTP idempotency (epic [#275](https://github.com/collinbrowse/CrewCue/issues/275))

- **On `main`:** `@crewcue/platform-client` (`ActionRegistry`, `NoticeBus`, error catalog, map-locate visual); mobile/web `TransientNoticeHost`; `useAction` on Pace/GPX/map; HTTP idempotency (claim/complete/release, migrations `0010`–`0012`, canonical JSON hash); shell errors → `NoticeBus`; CI `db:migrate` before `test:pg`.
- **Docs:** `docs/platform/actions-and-notices.md`, `packages/platform-client/PHASES.md`.
- **Staging ops:** Run `npm run db:migrate` through `0012_http_idempotency_state.sql` before soak.
- **Validation:** `npm run verify` green before merge.

## Recent (2026-05-17): Critical correctness fix — first aid station distance preservation (**merged** PR [#281](https://github.com/collinbrowse/CrewCue/pull/281) → `main`)

- **Cause:** PR #271’s projection repair always forced the first checkpoint to mile 0, even when an uploaded GPX/KML/JSON course had aid-station waypoints but no explicit Start waypoint. That silently saved “Aid Station 1” as the race start distance.
- **Fix:** `checkpointsWithProjectedDistances` now anchors the first checkpoint to 0 only when the checkpoint is colocated with the route start; loop finish anchoring also requires the first checkpoint to be the route start and the last checkpoint to be at the route end.
- **Validation:** `npm test -w @crewcue/map-core` and root `npm run verify` green (merge `ad02bc7` on `main`).

## Recent (2026-05-14): Mobile Pace / map — prefer saved course arc over projection splits

- **Cause:** Pace and map sheet used **`checkpointSplits[].distanceMetersFromStart` ahead of `room.course.checkpoints[].distanceMetersFromStart`**, so stale WS2 projection snapshots could show wrong miles (e.g. first Bridal ~34 mi) even when the room course from `PUT /course` had correct arc distances.
- **Fix:** `AuthenticatedReadoutsScreen` (`cumMetersAtCp`, row mile label) and `TrackMapDashboardScreen` (`checkpointDistanceById`, next-aid distance) now **prefer each checkpoint’s saved `distanceMetersFromStart`**, with splits as fallback.
- **Validation:** `npx tsc --noEmit -p apps/mobile` green.

## Recent (2026-05-14): TMR duplicate-aid projected miles (Bridal Veil first pass)

- **Cause:** Parser encounter order was correct, but **both** Bridal rows shared one waypoint pin; **pure geometry projection** snapped each row to the **nearest** polyline vertex (often the **second** pass ~34 mi), so Pace showed the wrong “first” Bridal mile.
- **Mitigation (local / PR #271 branch):** `buildRaceCourseFromGpx` carries **`distanceMetersFromStart` from encounter arc** as a hint; `checkpointsWithProjectedDistances` uses **`ENCOUNTER_HINT_SLACK_METERS`** (min search progress) and **`ENCOUNTER_HINT_TRUST_DIVERGENCE_METERS`** (if geodesic still disagrees with hint by >2 km, **clamp to hint**). A brief regression (inner `let clamped` shadowing + missing trust block) was fixed in `courseMetrics.ts`.
- **Validation:** `npm test -w @crewcue/map-core` and root **`npm run verify`** green after the fix.

## Recent (2026-05-14): Critical correctness fix — entitlement gate + race-start data preservation (branch `cursor/critical-correctness-bugs-5c10`, commits `094d116`, `01d768f`)

- **Completed:** `PUT /race-rooms/:roomId/course` and `GET/PUT /race-rooms/:roomId/map-workspace` now enforce the same `evaluateEntitlement` gate as `GET /race-rooms/:roomId`, preventing unpaid/expired rooms from reading or mutating race setup/map data via side routes.
- **Completed:** `PUT /course` now clears TaskBoard/WS4/WS5 course-dependent state only when material course data changes. Race-start-only saves preserve crew task status/assignments/snapshots.
- **Validation:** focused API route tests green (21/21), full API memory suite green (98/98), and root `npm run verify` green.
- **Residual audit leads not fixed here:** mobile map may still render route/dot from a different polyline than server projection in multi-layer/non-straight routes; chat prefetch may need stale-session cancellation. Track separately if product accepts severity/scope.
## Recent (**merged** PR [#264](https://github.com/collinbrowse/CrewCue/pull/264) → `main`, merge `a041ad0`, **Closes** [#263](https://github.com/collinbrowse/CrewCue/issues/263)): Android dev tooling + Metro + native compatibility

- **Metro / monorepo:** `apps/mobile/metro.config.js` (`watchFolders`, `resolver.nodeModulesPaths`); root **`npm run setup:macos-silicon`**, **`npm run pod:ios`**, **`scripts/ios-pod-install.mjs`**, **`scripts/setup-apple-silicon-toolchain.sh`**.
- **Android dev client:** `scripts/mobile-expo-start.mjs` — `adb reverse tcp:8081 tcp:8081`, **`REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`** on QEMU emulator. Prefer **`npm run android -w @crewcue/mobile`**. See `apps/mobile/README.md`.
- **Gradle `node`:** `apps/mobile/plugins/withAndroidGradleNodeExecutable.js` patches generated `settings.gradle` / `app/build.gradle` on prebuild (`NODE_BINARY`, Homebrew paths). Quick workaround: `cd apps/mobile/android && ./gradlew --stop`.
- **New Architecture / device boot:** `newArchEnabled: true` in `app.json` + pinned in `app.config.js`; `import "react-native-gesture-handler"` in `index.ts`; README troubleshooting for **`RNCSafeAreaProvider`** / 16 KB dialog; **`lazysodium-android` 5.2.0** (16 KB–aligned `libsodium.so`) via `withChatPushDecryption.js`.
- **Tests:** Deterministic chat crypto tamper fix in `crypto.test.ts`.
- **Branch cleanup:** Local **`feature/mobile-metro-android-dev-tooling`** deleted after merge; remote already removed by GitHub.

## Recent (**merged** PR [#261](https://github.com/collinbrowse/CrewCue/pull/261) → `main`, merge `8f3f3e8`, **Closes** [#260](https://github.com/collinbrowse/CrewCue/issues/260)): Map sheet phases + resilient next-aid

- **On `main`:** `TrackMapDashboardScreen` pre-start / finish / race sheet modes; next-aid + ETA without empty splits; runner marker from last accepted ping when projection missing; checkpoint labels use `title`; map pre-start uses room detail race anchor and start checkpoint; `apps/mobile/README.md` ExpoWebBrowser troubleshooting.
- **Validation:** `npm run verify` green before merge.

## Recent (2026-05-12): Canonical course length + route-based projection (**merged** PR [#258](https://github.com/collinbrowse/CrewCue/pull/258) → `main`, merge `a880d44`, **Closes** [#257](https://github.com/collinbrowse/CrewCue/issues/257))

- **On `main`:** `recomputeRaceProjection` requires `routeMetricPoints` (≥ 2); canonical length; checkpoint splits require projected `distanceMetersFromStart` (no chord fallback). `raceRooms` resolves route from workspace; course + map-workspace gates when ≥ 2 checkpoints. Mobile Pace tri-column readouts, race start clock row, `paceDeltaAhead` vs `danger` for vs-plan line, `+- 0min` within 1m of plan; `TrackMapDashboardScreen` canonical length chain; `docs/api/ws2-task2-projection.md` updated.

## Recent (2026-05-12): Race setup — native race start + time zone (**merged** PR [#254](https://github.com/collinbrowse/CrewCue/pull/254) → `main`, merge `5b1a791`, **Closes** [#253](https://github.com/collinbrowse/CrewCue/issues/253))

- **On `main`:** `GpxImportScreen` always shows **Race start** with OS date/time pickers (`@react-native-community/datetimepicker`, `timeZoneName`) and searchable **IANA** list; `luxon` normalizes wire `raceStartAt`; **Finish race setup** PATCHes start when course exists and it changed; **Course settings** drops ISO field (points to Race setup); **Athlete setup** uses same picker; race start UI is **not** client-gated by role (API authz unchanged); **expo-localization** + datetimepicker plugins in `apps/mobile/app.json`.
- **Validation:** `npm run verify` green before merge; **rebuild iOS/Android dev clients** after pulling (native modules).

## Recent (2026-05-12): Unified course metrics + projection alignment (**merged** PR [#249](https://github.com/collinbrowse/CrewCue/pull/249) → `main`, merge `9e0d028`)

- **On `main`:** Contracts/map-core/API course pipeline (geodesic-derived metrics, pace-aware baselines, `PUT .../course` recompute + room distance/gain/loss); clients consume server-derived metrics; aligns with **#248** race start / projection bootstrap work.
- **Pre-merge conflict note:** `main` post-#248 had briefly diverged in `raceRooms.ts`; resolved on branch before merge (`d52ca98`).

## Recent (2026-05-12): Race start anchor, projection bootstrap, map sheet (**merged** PR [#248](https://github.com/collinbrowse/CrewCue/pull/248), **Closes** [#247](https://github.com/collinbrowse/CrewCue/issues/247))

- **API (on `main`):** New rooms default **active**; removed **`POST /race-rooms/:id/activate`**; **`PUT .../course`** requires **`raceStartAt`** when saving a course; permissions key **`canEditRaceSetup`**; bootstrap projection on eligible **GET /projection** / after course save; pings use **`raceStartAt ?? activatedAt`** anchor; **`setRaceRoomStatusForTests`** allowed under **postgres** for integration tests.
- **Clients:** Mobile + web `updateRaceCourse` require **`raceStartAt`**; GPX import + athlete setup collect start time; Pace **Race setup** (`GpxImportScreen`) edits start with native pickers + time zone; projection background poll without `room.status === "active"` gate; quiet **404** clears projection; Pace tab uses **`raceStartAt ?? activatedAt`**; map sheet peek shows **next aid + stats** first, checklist when expanded.
- **Docs:** `docs/api/ws2-task2-projection.md` describes bootstrap + `raceStartAt` (no activate).

## Recent fix (2026-05-11): Pace Edit + timeline rail (**merged** PR [#246](https://github.com/collinbrowse/CrewCue/pull/246), **Closes** [#245](https://github.com/collinbrowse/CrewCue/issues/245))

- **Edit:** `GET /race-rooms/:id` permissions include `canEditCheckpointStops`; Pace uses `(roomDetail.permissions ?? JWT current-room role mirror)` for course + stops; Pace focus refetches room detail when missing/stale room id.
- **Timeline rail:** `PaceTimelineRail` + `paceRailCheckpointRowModel` / `paceRailFinishRowModel` — active leg **purple** trunk; marker **opaque** (`card` fill); approach/dwell/finish fractions; **past legs pin marker bottom** after focus advances or checkpoint completed; **dwell** uses `statusRail` card tint + primary left bar and **“At station”** badge vs **“In progress”** en route.
- **Also on `main` from #246:** `CheckpointPickMapScreen`, course/map/linking, projection timeliness tests/docs, `slugToTitle` / course helpers in `@crewcue/map-core`, `AuthenticatedReadoutsScreen` Pace surface (stale banner, course PUT path, etc.).

## Recent (2026-05-15): Upload error UX + Railway map-core build

- **Upload failures:** Generic “choose GPX/KML/JSON” masked API errors (missing route line, recompute failure, invalid payload). `GpxImportScreen` maps those strings to specific copy; `PUT /course` logs `course_metrics_recompute_failed` on recompute throw.
- **Railway:** `railway.toml` `buildCommand` now builds `@crewcue/contracts`, `@crewcue/map-core`, then `@crewcue/api` so staging ships encounter-hint projection after deploy.
- **TMR Bridal (~34 mi):** Map-core hint fix is merged in PR #271; staging/data may still need deploy plus course re-import to replace old saved miles.
- **Next:** Re-import Telluride JSON after deployment, confirm DB first Bridal ~4.4 mi; check staging logs if upload still 400.

## Session status snapshot

- Last updated: 2026-05-20 (UTC)
- **Current roadmap phase:** Regression coverage hardening after platform actions/notices/HTTP idempotency epic **#275 / PR #282** merged to `main` (`80e3843`).
- **Active branch:** `cursor/regression-test-coverage-9f1d`.
- **Active PR:** [#286](https://github.com/collinbrowse/CrewCue/pull/286).
- **Active issue:** No new GitHub issue was created by this cron run because only read-only GitHub CLI access was available in-agent; link a tracking issue before merge if repository policy requires one.
- **Acceptance criteria:** inspect recent merged code, choose one meaningful weak coverage area, add deterministic tests only, run relevant tests plus CI-parity verification, document handoff.
- **Files changed:** `services/api/src/routes/raceRooms.test.ts` adds route-level API coverage; `docs/sdlc/agent-handoff.md` records continuity.
- **Do-not-change guardrails:** no production behavior changes; keep HTTP centralized; do not alter idempotency persistence/migrations; avoid mobile/web cosmetic or snapshot-only tests.

## Completed

- Added an injected API regression test proving `POST /race-rooms` replays the same `Idempotency-Key` + body with the original `201` response and room id.
- The same test proves reusing that key with a different request body returns `409` instead of creating a second room.
- This covers the business-risk path where mobile/web retries after network uncertainty could duplicate race rooms or silently accept conflicting idempotent retries.

## Next 1-3 tasks

1. Monitor the regression-coverage PR and CI; merge only after required checks remain green.
2. If merge policy requires a linked issue, create/link a tracking issue before merge and update the PR body with `Closes #...`.
3. Continue the next coverage scan on PR #282's PUT `/course` and manual-stop idempotency paths, especially Postgres-backed retries.

## Validation summary

- `npm ci` - **pass** after the workspace initially lacked `node_modules`; audit output reports existing dependency vulnerabilities (23 total, 2 critical).
- `npm run build -w @crewcue/api && PERSISTENCE_MODE=memory node --test services/api/dist/services/api/src/routes/raceRooms.test.js` - **pass** (15/15).
- `npm run test:memory -w @crewcue/api` - **pass** (106 pass, 3 skipped).
- `npm run verify` - **pass**.

## Open risks/blockers/questions

- No production behavior changed; residual risk is limited to test-only coverage.
- GitHub issue creation was not performed because this automation run did not have an allowed write path for issues.
- Slack notification failed because the Cursor bot is not in `#all-crewcue`; this run's outcome is available in PR #286.
- Dependency audit warnings remain pre-existing and were not addressed in this test-coverage task.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Server remains source of truth for race room creation and idempotent mutation outcomes.
- Do not layer compatibility shims around current-branch-only test behavior.

## Successor prompt

```text
Review the regression coverage PR on branch cursor/regression-test-coverage-9f1d. Verify CI, link/create an issue if merge policy requires it, and continue coverage scanning on PR #282's PUT /course and manual-stop idempotency paths.
```
