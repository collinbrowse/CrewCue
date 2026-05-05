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
- **Branch:** `feature/220-map-dashboard` · PR [#221](https://github.com/collinbrowse/CrewCue/pull/221) · issue [#220](https://github.com/collinbrowse/CrewCue/issues/220).
- **Scope:** Map-first mobile dashboard + root tabs Map / Pace / Chat / Profile; map-core course position helpers; explicit projection poll setter.

## Current objective

Merge [#221](https://github.com/collinbrowse/CrewCue/pull/221) after CI green (`Closes #220` already in PR body). Branch is ready to push; local `npm run verify` passed 2026-05-05.

## Acceptance criteria (this branch)

1. Root tabs: Map, Pace (Readouts stack), Chat (placeholder), Profile (settings + avatar + sign out).
2. Map home: full-screen map; course line + padded `fitBounds` when not following a runner position; follow-runner via projection (disabled on user pan); **layers** slide-over from the right; sheet respects vertical safe area; map chrome uses high-contrast tokens (not neon-on-white); user-location FAB (permission + `easeTo`); runner-avatar FAB centers runner; profile entry is **person** icon (not runner art). No mobile Map workspace screen (removed); **Race setup** under Workspace settings when a race is selected.
3. `onSetProjectionPollEnabled` on shell; map dashboard enables poll on focus, disables on blur.
4. `npm run verify` passes.

## Delivered (feature branch)

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

1. Watch CI on PR #221; fix any failures.
2. Manual iOS/Android smoke: tabs, sheet drag, layers slide-over, user-location + runner FABs, course fit vs follow, race picker, Profile → workspace.
3. Optional: update `mvp-ui-development-spec.md` OperateHome → MapHome table row (docs-only).

## Validation summary

- `npm run verify` passed locally on `feature/220-map-dashboard` (2026-05-05, ~3m including mobile `expo export`).

## Open risks/blockers/questions

- Map `onRegionDidChange` `userInteraction` must be verified on devices (disable follow only on real user gestures).
- Elevation row uses GeoJSON Z on workspace tracks when present; otherwise shows "—".

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
PR #221: push if needed, confirm GitHub Actions green, merge when ready; device-smoke sheet two-state + grabber animation, badge clearance, FAB fade, map follow on pan.
```
