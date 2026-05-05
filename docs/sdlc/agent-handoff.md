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
- **Git:** working branch `feature/218-two-design-systems` for redesign/toggle implementation tied to [#218](https://github.com/collinbrowse/CrewCue/issues/218).
- **In progress:** full visual redesign replacement with two global runtime design systems (`kinetic`, `performance`) across mobile + web, each with light/dark variants bound to device setting.
- **Validation:** local `npm run verify` passed on this branch after design-system integration.

## Current objective

Complete PR for [#218](https://github.com/collinbrowse/CrewCue/issues/218): ship the full redesign migration with an immediate, persisted in-app toggle between `kinetic` and `performance`, with automatic light/dark mode behavior.

## Acceptance criteria (post-merge)

1. Mobile + web expose an in-app design-system selector.
2. Switching design systems applies globally in the same session (no restart required).
3. Selection persists across app restart/refresh.
4. Only `kinetic` and `performance` are selectable.
5. Root **`npm run verify`** passes.

## Delivered on `main` (from #204 / #203)

- Contracts: `NavigationRouteMeta`, `PostNavigationRouteResponse`, `GeocodeSearchResultItem`.
- API: [`geocodeRoutes.ts`](services/api/src/routes/geocodeRoutes.ts); routing resolves `checkpointIds` from room workspace; crow-flight detour meta for hike UX.
- map-core: `summarizeParsedCourseUploadAnalytics`, `parseUploadToWorkspaceLayerWithAnalytics`.
- Mobile: [`NavigateScreen.native.tsx`](apps/mobile/src/navigation/NavigateScreen.native.tsx), [`MapWorkspaceScreen.native.tsx`](apps/mobile/src/navigation/MapWorkspaceScreen.native.tsx), [`routeProgress.ts`](apps/mobile/src/features/maps/routeProgress.ts), basemap prefs + `expo-location` + AsyncStorage deps.
- Web: [`MapWorkspace.tsx`](apps/web/src/MapWorkspace.tsx), [`analytics/track.ts`](apps/web/src/analytics/track.ts), API client extensions, [`mapStyleUrl.ts`](apps/web/src/mapStyleUrl.ts).
- CI/docs: `.github/workflows/ci.yml` adds `MAPTILER_API_KEY` placeholder; `.env.example` documents server MapTiler key.

## Next 1-3 tasks

1. Review feature diff for `feature/218-two-design-systems` and open PR with `Closes #218`.
2. Verify toggle UX manually on-device/simulator and in web browser.
3. Merge after green checks, then resume staging/docs follow-up tasks.

## Validation summary

- Added shared design registry: `packages/contracts/src/designSystems.ts` (+ export via contracts index).
- Mobile: root provider + persisted selection + settings toggle + navigation theming/token updates.
- Web: root provider + persisted selection + CSS token scopes + map workspace design toggle.
- Added onboarding docs: `docs/design-systems.md`.
- Validation commands passed:
  - `npm run build -w @crewcue/contracts`
  - `npm run typecheck -w @crewcue/web`
  - `npm run typecheck -w @crewcue/mobile`
  - `npm run verify`

## Open risks/blockers/questions

- Visual parity tuning may still be needed on secondary/less-frequent screens with local hardcoded styles.
- Font-family fallbacks are defined, but exact custom font loading behavior should be checked on device/web.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
On feature/218-two-design-systems, open PR for #218 with Closes #218. Confirm mobile/web runtime toggle behavior manually, then merge after CI.
```
