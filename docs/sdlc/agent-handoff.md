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
- **Branch:** `feature/220-map-dashboard` (issue [#220](https://github.com/collinbrowse/CrewCue/issues/220)).
- **Scope:** Map-first mobile dashboard + root tabs Map / Pace / Chat / Profile; map-core course position helpers; explicit projection poll setter.

## Current objective

Open PR for #220, link `Closes #220`, merge after CI green.

## Acceptance criteria (this branch)

1. Root tabs: Map, Pace (Readouts stack), Chat (placeholder), Profile (settings + avatar + sign out).
2. Map home: full-screen map, follow-runner (disabled on user pan/zoom), layers modal, sheet with checklist, race picker, workspace gear.
3. `onSetProjectionPollEnabled` on shell; map dashboard enables poll on focus, disables on blur.
4. `npm run verify` passes.

## Delivered (feature branch)

- [`MapStack.tsx`](apps/mobile/src/navigation/MapStack.tsx) replaces Operate stack; [`TrackMapDashboardScreen.tsx`](apps/mobile/src/navigation/TrackMapDashboardScreen.tsx) map home.
- [`ProfileStack.tsx`](apps/mobile/src/navigation/ProfileStack.tsx) + [`ProfileHomeScreen.tsx`](apps/mobile/src/navigation/ProfileHomeScreen.tsx): design system, offline maps toggle, sign out; workspace menu trimmed to race ops.
- [`packages/map-core/src/coursePosition.ts`](packages/map-core/src/coursePosition.ts) + tests; `npm run build -w @crewcue/map-core` refreshes `dist/` for consumers.
- [`AuthedShellContext`](apps/mobile/src/shell/AuthedShellContext.tsx) + [`App.tsx`](apps/mobile/App.tsx): `onSetProjectionPollEnabled`.
- [`linking.ts`](apps/mobile/src/navigation/linking.ts) updated for new tab names.

## Next 1-3 tasks

1. `gh pr create` with **Linked issues** `Closes #220`; push branch if needed.
2. Manual iOS/Android smoke: tabs, sheet drag, layers, follow FAB, race picker, Profile → workspace menu link.
3. Optional: update `mvp-ui-development-spec.md` OperateHome → MapHome table row (docs-only).

## Validation summary

- `npm run verify` passed locally on `feature/220-map-dashboard` (2026-05-05).

## Open risks/blockers/questions

- Map `onRegionDidChange` `userInteraction` must be verified on devices (disable follow only on real user gestures).
- Elevation row uses GeoJSON Z on workspace tracks when present; otherwise shows "—".

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`).
- Do not commit real MapTiler/OSRM secrets.

## Successor prompt

```text
On branch feature/220-map-dashboard: open PR with Closes #220, fill PR template Linked issues, confirm CI green, then manual iOS/Android smoke for map follow-mode + sheet.
```
