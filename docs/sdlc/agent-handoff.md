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
- **Git:** `main` fast-forwarded to `origin/main` at merge commit **`44fb33a`**. Local `feature/218-two-design-systems` branch deleted after merge.
- **Merged:** [#219](https://github.com/collinbrowse/CrewCue/pull/219) closed [#218](https://github.com/collinbrowse/CrewCue/issues/218) (dual design systems + light/dark behavior + Android AsyncStorage local-repo patch).
- **Working tree note:** local user edits still present in `apps/mobile/package.json`, `package-lock.json`, and untracked `tsconfig.json` (left untouched).

## Current objective

Post-merge stabilization and follow-on QA for the redesigned mobile/web theming system now on `main`.

## Acceptance criteria (post-merge)

1. iOS + Android dev workflows remain reliable (`npm run ios -w @crewcue/mobile`, `npx expo run:android`).
2. System-appearance behavior on iOS/Android is validated manually (Auto mode + forced overrides).
3. Follow-up docs reflect testing commands and known caveats.

## Delivered on `main` (from #204 / #203)

- Contracts: `NavigationRouteMeta`, `PostNavigationRouteResponse`, `GeocodeSearchResultItem`.
- API: [`geocodeRoutes.ts`](services/api/src/routes/geocodeRoutes.ts); routing resolves `checkpointIds` from room workspace; crow-flight detour meta for hike UX.
- map-core: `summarizeParsedCourseUploadAnalytics`, `parseUploadToWorkspaceLayerWithAnalytics`.
- Mobile: [`NavigateScreen.native.tsx`](apps/mobile/src/navigation/NavigateScreen.native.tsx), [`MapWorkspaceScreen.native.tsx`](apps/mobile/src/navigation/MapWorkspaceScreen.native.tsx), [`routeProgress.ts`](apps/mobile/src/features/maps/routeProgress.ts), basemap prefs + `expo-location` + AsyncStorage deps.
- Web: [`MapWorkspace.tsx`](apps/web/src/MapWorkspace.tsx), [`analytics/track.ts`](apps/web/src/analytics/track.ts), API client extensions, [`mapStyleUrl.ts`](apps/web/src/mapStyleUrl.ts).
- CI/docs: `.github/workflows/ci.yml` adds `MAPTILER_API_KEY` placeholder; `.env.example` documents server MapTiler key.

## Next 1-3 tasks

1. Run a quick post-merge mobile smoke on iOS + Android appearance switching and map-screen fallback behavior.
2. Add/refresh runbook notes for reliable simulator/emulator commands (especially env-loading and native build paths).
3. Pick next roadmap issue from current open backlog after smoke is confirmed.

## Validation summary

- #219 merged to `main` with:
  - shared design registry + `kinetic`/`performance` + light/dark variants
  - persisted runtime selection on mobile + web
  - iOS appearance wiring fixes in `apps/mobile/ios/CrewCue/*`
  - Android AsyncStorage local Maven patch in `patches/@react-native-async-storage+async-storage+3.0.2.patch`
- Pre-merge validation for #219 included `npm run verify` pass.

## Open risks/blockers/questions

- iOS simulator appearance behavior should be re-checked after clean rebuilds when Xcode/SDK versions change.
- Emulator/simulator test instructions should stay explicit to avoid `npx expo run:*` path/env confusion.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
On main after #219 merge: run iOS+Android smoke for theme auto/manual mode behavior, update any runbook gaps for reliable local testing commands, then pick next prioritized backlog issue.
```
