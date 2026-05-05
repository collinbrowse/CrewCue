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
- **Merged:** PR [#221](https://github.com/collinbrowse/CrewCue/pull/221) → `main` (merge commit `f12a28c` on origin); closes [#220](https://github.com/collinbrowse/CrewCue/issues/220).
- **Active branch for new work:** `main` (pull latest before branching).

## Current objective

Continue MVP mobile from **`main`**: device QA on map follow / `onRegionDidChange` `userInteraction`, optional docs alignment (`mvp-ui-development-spec.md` MapHome row), then pick the next GitHub issue from the UI roadmap.

## Acceptance criteria (delivered on main via #221)

1. Root tabs: Map, Pace (Readouts stack), Chat (placeholder), Profile (settings + avatar + sign out).
2. Map home: full-screen map; course line + padded `fitBounds` when not following a runner position; follow-runner via projection (disabled on user pan); **layers** slide-over from the right; sheet respects vertical safe area; map chrome uses high-contrast tokens (not neon-on-white); user-location FAB (permission + `easeTo`); runner-avatar FAB centers runner; profile entry is **person** icon (not runner art). No mobile Map workspace screen (removed); **Race setup** under Workspace settings when a race is selected.
3. `onSetProjectionPollEnabled` on shell; map dashboard enables poll on focus, disables on blur.
4. `npm run verify` passes (CI on merge expected green).

## Delivered (now on `main`, PR #221)

- [`MapStack.tsx`](apps/mobile/src/navigation/MapStack.tsx) replaces Operate stack; [`TrackMapDashboardScreen.tsx`](apps/mobile/src/navigation/TrackMapDashboardScreen.tsx) map home.
- [`ProfileStack.tsx`](apps/mobile/src/navigation/ProfileStack.tsx) + [`ProfileHomeScreen.tsx`](apps/mobile/src/navigation/ProfileHomeScreen.tsx): design system, offline maps toggle, sign out; workspace menu trimmed to race ops.
- [`packages/map-core/src/coursePosition.ts`](packages/map-core/src/coursePosition.ts) + tests; `npm run build -w @crewcue/map-core` refreshes `dist/` for consumers.
- [`AuthedShellContext`](apps/mobile/src/shell/AuthedShellContext.tsx) + [`App.tsx`](apps/mobile/App.tsx): `onSetProjectionPollEnabled`.
- [`linking.ts`](apps/mobile/src/navigation/linking.ts) updated for new tab names.
- Map sheet: removed Map workspace, Navigate, and Race setup buttons; [`WorkspaceMenuScreen.tsx`](apps/mobile/src/navigation/WorkspaceMenuScreen.tsx) adds **Race setup** (edit) when `s.room` is set; empty map uses **Open settings** only.
- Map polish: [`TrackMapDashboardScreen.tsx`](apps/mobile/src/navigation/TrackMapDashboardScreen.tsx) — `Camera` ref + `fitBounds`/`easeTo`, right layers panel, GPX line colors by mode, theme-safe pills; deleted unused [`MapWorkspaceScreen`](apps/mobile/src/navigation/) native/web entry files.
- Sheet UX (same file): **peek vs fully expanded only** (no middle snap); **cubic-out ~320ms** animation on grabber tap and after drag release; sheet height from **measured tab content bottom** + **badge row `measureInWindow`** for expanded top; sheet **`bottom: 0`** to root so the card fills above the tab bar (scroll `paddingBottom` keeps content off the home indicator); FAB opacity still `1 −` expansion progress.
- Mercator helpers: [`mercatorTileMath.ts`](apps/mobile/src/features/maps/mercatorTileMath.ts) + test; [`mapStyleUrl.ts`](apps/mobile/src/features/maps/mapStyleUrl.ts) extended.
- [`theme.ts`](apps/mobile/src/design-system/theme.ts): light mode `color.primary` maps to contract `primary` (not `primaryContainer`) so chrome is legible across design systems.

## Next 1-3 tasks

1. `git checkout main && git pull` — confirm post-merge CI green on `main`.
2. Manual iOS/Android smoke on **production build or dev client**: sheet two-state + animation, badges, FAB fade, layers, follow-runner vs pan, race picker, Profile → workspace.
3. Optional: update `mvp-ui-development-spec.md` OperateHome → MapHome table row (docs-only).

## Validation summary

- `npm run verify` passed locally before merge (2026-05-05). Re-run on latest `main` after pull if you touch code.

## Open risks/blockers/questions

- Map `onRegionDidChange` `userInteraction` must be verified on devices (disable follow only on real user gestures).
- Elevation row uses GeoJSON Z on workspace tracks when present; otherwise shows "—".

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
#221 merged to main. Pull main, confirm CI green, device-smoke map dashboard; then open the next scoped issue from the UI roadmap (or docs-only spec row for MapHome).
```
