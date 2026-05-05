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

- Last updated: 2026-05-05 (America/Chicago)
- **Git:** `main` fast-forwarded to `origin/main` (**`9847af6`**). Removed stale locals **`feature/maps-audit-closure`** and **`fix/209-pr-decision-doc-guard-markdown`** (remotes already deleted). Working tree clean; **no open PRs**.
- **Merged recently:** [#204](https://github.com/collinbrowse/CrewCue/pull/204) (maps audit closure, **#203**), [#213](https://github.com/collinbrowse/CrewCue/pull/213), [#212](https://github.com/collinbrowse/CrewCue/pull/212), [#210](https://github.com/collinbrowse/CrewCue/pull/210) (**#209**). **#206** (GPX parity) **closed**.
- **Open issues (sample):** [#205](https://github.com/collinbrowse/CrewCue/issues/205) MapTiler key docs/ops; sprint/backlog **#186**, **#185**, **#182** (see GitHub **Open** filter).
- Sprint milestone: maps + single-upload GPX parity — **shipped on `main`**; focus shifts to **staging env + QA + docs**.

## Current objective

Prove maps audit closure on **staging**: `MAPTILER_API_KEY` on the API service, geocode + routing + web/mobile map flows; close or advance **#205** once behavior is documented.

## Acceptance criteria (post-merge)

1. Staging API has **`MAPTILER_API_KEY`**; `GET …/geocode/search` and routing paths succeed for a smoke room.
2. Web + mobile map workspace / navigate flows match expectations (checkpoints, offline pack lifecycle where applicable).
3. Root **`npm run verify`** green on latest **`main`** before the next feature branch ships.

## Delivered on `main` (from #204 / #203)

- Contracts: `NavigationRouteMeta`, `PostNavigationRouteResponse`, `GeocodeSearchResultItem`.
- API: [`geocodeRoutes.ts`](services/api/src/routes/geocodeRoutes.ts); routing resolves `checkpointIds` from room workspace; crow-flight detour meta for hike UX.
- map-core: `summarizeParsedCourseUploadAnalytics`, `parseUploadToWorkspaceLayerWithAnalytics`.
- Mobile: [`NavigateScreen.native.tsx`](apps/mobile/src/navigation/NavigateScreen.native.tsx), [`MapWorkspaceScreen.native.tsx`](apps/mobile/src/navigation/MapWorkspaceScreen.native.tsx), [`routeProgress.ts`](apps/mobile/src/features/maps/routeProgress.ts), basemap prefs + `expo-location` + AsyncStorage deps.
- Web: [`MapWorkspace.tsx`](apps/web/src/MapWorkspace.tsx), [`analytics/track.ts`](apps/web/src/analytics/track.ts), API client extensions, [`mapStyleUrl.ts`](apps/web/src/mapStyleUrl.ts).
- CI/docs: `.github/workflows/ci.yml` adds `MAPTILER_API_KEY` placeholder; `.env.example` documents server MapTiler key.

## Next 1-3 tasks

1. **Staging:** set **`MAPTILER_API_KEY`** on the API service; run maps/geocode QA.
2. **Docs/Ops:** [#205](https://github.com/collinbrowse/CrewCue/issues/205) — when MapTiler keys are required vs optional.
3. **Backlog:** pick next **Sprint 1** issue (**#186** / **#185**) or **Epic A** (**#182**) per roadmap priority.

## Validation summary

- **2026-05-04 sync:** `git fetch --prune`, `git checkout main`, `git pull --ff-only`; deleted gone-tracking locals; **`main` == `origin/main`**.
- **Railway:** [#212](https://github.com/collinbrowse/CrewCue/pull/212) on `main`; keep dashboard **Build Command** aligned with `railway.toml` (`npm run build -w @crewcue/api` only) to avoid **EBUSY** on `.vite`.
- **Mobile web:** `secureStorage.{web,native}.ts` split — no `expo-secure-store` on web.
- **PR #204** merged; CI was green pre-merge; re-run **`npm run verify`** locally after large pulls if you touch code.
- **2026-05-05 local dev unblock:** ran `npx expo install expo-location` in `apps/mobile`; `npm ls expo-location --workspace @crewcue/mobile` now resolves `expo-location@55.1.8`.
- **2026-05-05 mobile env fix:** added `apps/mobile/app.config.js` to read `apps/mobile/.env` and expose `extra.maptilerApiKey`, plus mobile basemap fallback reads (`process.env` -> `Constants.expoConfig.extra`) in `apps/mobile/src/features/maps/mapStyleUrl.ts`. Validation: `node -e "const cfg=require('./apps/mobile/app.config.js')({config:{}}); console.log(Boolean(cfg.extra?.maptilerApiKey));"` -> `true`, and `npm run typecheck -w @crewcue/mobile` passes.

## Open risks/blockers/questions

- MapTiler geocode URL shape vs Cloud API (watch **502** / empty features).
- Offline pack polling: confirm **`OfflinePack.status()`** reaches **`complete`** on hardware.
- GPX: API stores **parsed** course + simplified geometry, not raw GPX bytes; primary route layer id **`crewcue-primary-course-route`**.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
On latest main: staging MAPTILER_API_KEY + maps/geocode smoke; advance or close #205. Then branch from main for next Sprint 1 / Epic A issue per roadmap.
```
