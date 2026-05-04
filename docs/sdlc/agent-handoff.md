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
- Branch: `feature/maps-audit-closure`
- Active issue: [#203](https://github.com/collinbrowse/CrewCue/issues/203) maps/navigation audit closure (geocode, GPS progression, web parity, analytics, DS)
- Active PR: [#204](https://github.com/collinbrowse/CrewCue/pull/204) → `main` (**Closes #203**)
- Current priority: CI on new PR; native QA for Navigate destinations + offline pack polling + MapTiler geocode proxy wiring in staging
- Sprint milestone: audit-gap closure on top of maps-navigation-plan baseline

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

1. Open PR from `feature/maps-audit-closure` → `main` with **`Closes #203`**; confirm Actions green.
2. Staging/dev: set **`MAPTILER_API_KEY`** on API service (distinct from optional public tile keys).
3. Manual QA: offline corridor download completion vs timeout; geocode empty/error paths; web map style reload after basemap change without checkpoint loss.

## Validation summary

- `npm run verify` (root): **pass** after fixing `PostRoomRouteInput` import source (`../api/client`, not `@crewcue/contracts`).

## Open risks/blockers/questions

- MapTiler geocode URL shape must match Cloud API for production (monitor `502`/empty features).
- Offline pack polling assumes `OfflinePack.status()` transitions to `"complete"`; validate on hardware.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
PR for branch feature/maps-audit-closure: ensure body includes Closes #203; confirm CI green.
Validate MAPTILER_API_KEY on staging API + smoke geocode + Navigate address flow + offline pack completion on device.
```
