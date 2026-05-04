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

## Session status snapshot

- Last updated: 2026-05-04 (America/Chicago)
- CI fix shipped: [#210](https://github.com/collinbrowse/CrewCue/pull/210) (**Closes #209**) — `pr-decision-doc-guard` now accepts `- **Decision:**` / `- **Assumption:**` / `- **Summary:**` bullets (colon inside bold).
- Railway hotfix merged: [#212](https://github.com/collinbrowse/CrewCue/pull/212) (**Closes #211**) — `railway.toml` build is `npm run build -w @crewcue/api` only (no second `npm ci`); remote `fix/railway-ebusy-npm-ci` deleted.
- **`main`**: includes [#213](https://github.com/collinbrowse/CrewCue/pull/213) (mobile secureStorage web, API client polish, CI `MAPTILER_API_KEY`, PR template note), [#212](https://github.com/collinbrowse/CrewCue/pull/212) Railway, and earlier merges through **#202** / **#210**.
- **Only open PR:** [#204](https://github.com/collinbrowse/CrewCue/pull/204) from **`feature/maps-audit-closure`** → **`main`** (**Closes #203**). [#207](https://github.com/collinbrowse/CrewCue/pull/207) is **already merged** into this branch (merge commit on the PR branch, not a separate open PR). Branch was **synced with `origin/main`** (merge) so it carries **#213** too; **`npm run verify`** green locally after sync.
- Related: [#206](https://github.com/collinbrowse/CrewCue/issues/206) GPX parity — still track until you close it or tie it to a follow-up issue.
- Current priority: green CI on **#204**, merge to **`main`**, then staging **`MAPTILER_API_KEY`** + QA.
- Sprint milestone: maps + single-upload GPX parity

## Current objective

Ship synchronized fixes from the maps audit closure plan: MapTiler **server** geocode proxy, richer routing payloads (`checkpointIds` vs coordinates), GPS-based step progression (replacing timer hack), web checkpoint placement + analytics + basemap picker aligned to CSS tokens, mobile basemap persistence, offline download lifecycle (`started`/`completed`/`failed`/`deleted`) via pack status polling, hike detour-ratio UX hint from routing `meta`.

## Acceptance criteria (merge gate)

1. API: `GET /race-rooms/:roomId/geocode/search` (requires `MAPTILER_API_KEY`); routing returns `{ route, meta? }` with `detourRatio` / `hikeRouteQuality` when applicable.
2. Mobile Navigate: checkpoint sequence vs ends-only vs address (geocode) vs lat/lng; `expo-location` foreground permission + watch-based progression while online; reroute analytics includes failed outcomes.
3. Web MapWorkspace: placement-mode map clicks add/remove checkpoints; `emitWebAnalytics` for uploads/layers/checkpoints; basemap picker persists in `localStorage`.
4. Root **`npm run verify`** green.

## Delivered on branch (issue #203)

- Contracts: `NavigationRouteMeta`, `PostNavigationRouteResponse`, `GeocodeSearchResultItem`.
- API: [`geocodeRoutes.ts`](services/api/src/routes/geocodeRoutes.ts); routing resolves `checkpointIds` from room workspace; crow-flight detour meta for hike UX.
- map-core: `summarizeParsedCourseUploadAnalytics`, `parseUploadToWorkspaceLayerWithAnalytics`.
- Mobile: [`NavigateScreen.native.tsx`](apps/mobile/src/navigation/NavigateScreen.native.tsx), [`MapWorkspaceScreen.native.tsx`](apps/mobile/src/navigation/MapWorkspaceScreen.native.tsx), [`routeProgress.ts`](apps/mobile/src/features/maps/routeProgress.ts), basemap prefs + `expo-location` + AsyncStorage deps.
- Web: [`MapWorkspace.tsx`](apps/web/src/MapWorkspace.tsx), [`analytics/track.ts`](apps/web/src/analytics/track.ts), API client extensions, [`mapStyleUrl.ts`](apps/web/src/mapStyleUrl.ts).
- CI/docs: `.github/workflows/ci.yml` adds `MAPTILER_API_KEY` placeholder; `.env.example` documents server MapTiler key.

## Next 1-3 tasks

1. **[#204](https://github.com/collinbrowse/CrewCue/pull/204):** confirm Actions green after sync; merge to **`main`** (resolves **#203** per PR body).
2. Staging: set **`MAPTILER_API_KEY`** on the API service; GPX / map workspace QA.
3. Triage [#206](https://github.com/collinbrowse/CrewCue/issues/206) (close or split follow-ups) once **#204** is on `main`.

## Validation summary

- **`main`**: [#213](https://github.com/collinbrowse/CrewCue/pull/213) merged; includes secureStorage web/native split, mobile API client URL/errors + tests, map workspace reload behavior, CI `MAPTILER_API_KEY`, PR template alignment with `pr-decision-doc-guard`.
- **`feature/maps-audit-closure`:** merged **`origin/main`** into the branch for **#204**; **`npm run verify`** green locally after sync.
- **Railway**: [#212](https://github.com/collinbrowse/CrewCue/pull/212) merged to `main`; staging build reported **green** (no EBUSY on `apps/web/node_modules/.vite`). Keep dashboard **Build Command** empty or aligned with `railway.toml`.
- Maps/mobile: map workspace **reload** seeds from `shell.room` when GET `/map-workspace` fails; **no full-screen gate** before Map mounts; **18s** timeout on sync. Mobile API client **trims trailing slashes** on `baseUrl`, surfaces Fastify **`message`** with **`error`**, and clearer generic **404** text — covered in `client.test.ts`. Cursor-only debug ingest / NDJSON / file logging **removed** before push.
- Mobile **web**: `expo-secure-store` has no `getValueWithKeyAsync` on web (runtime TypeError on sign-in). Added `src/storage/secureStorage.{ts,native.ts,web.ts}` — Metro picks **`.web`** (localStorage only, zero SecureStore) vs **`.native`** (real SecureStore); app code still imports `./storage/secureStorage`.

## Open risks/blockers/questions

- MapTiler geocode URL shape must match Cloud API for production (monitor `502`/empty features).
- Offline pack polling assumes `OfflinePack.status()` transitions to `"complete"`; validate on hardware.
- GPX parity: API still stores **parsed** course + simplified route geometry (not raw GPX bytes); primary route layer id is fixed (`crewcue-primary-course-route`).
- Railway: if the service **Build Command** in the dashboard overrides `railway.toml` and includes `npm ci && …`, the second `npm ci` can hit **EBUSY** on `apps/web/node_modules/.vite`. Use only `npm run build -w @crewcue/api` for the build step (contracts/map-core run inside that script and via `postinstall`).

## Delivered (on `feature/maps-audit-closure`; merged via [#207](https://github.com/collinbrowse/CrewCue/pull/207) into that branch)

- API: optional `routeOverlayLayer` on `PUT …/course`; `mergePrimaryCourseRouteLayer` in map-core.
- Clients: race setup, athlete wizard, native map workspace upload, web MapWorkspace (when API env vars set) send course + overlay from one parse.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
Single open PR #204 (feature/maps-audit-closure): confirm CI, merge to main. Staging MAPTILER_API_KEY + QA; close or retarget #206.
```
