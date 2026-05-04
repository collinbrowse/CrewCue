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
- Branch: `feature/maps-navigation-plan`
- Active issue: [#201](https://github.com/collinbrowse/CrewCue/issues/201) interactive maps + navigation (plan implementation)
- Active PR: [#202](https://github.com/collinbrowse/CrewCue/pull/202) → `main` (**Closes #201**)
- Current priority: merge readiness — CI on PR #202, manual native maps QA on dev client
- Sprint milestone: maps/workspace MVP aligned to engineering plan (Phases A–C)

## Current objective

Land dual-client Map Workspace + mobile Navigate + offline corridor/analytics instrumentation behind documented env (`EXPO_PUBLIC_MAPTILER_*`, `VITE_MAPTILER_*`, `OSRM_ROUTER_BASE_URL`, API analytics ingest).

## Acceptance criteria (merge gate)

1. Contracts include `RaceMapWorkspace` / layer geometry; `RaceRoom` carries optional `mapWorkspace`.
2. API: authenticated GET/PUT `/race-rooms/:roomId/map-workspace`; POST `/race-rooms/:roomId/routing/route` (OSRM proxy); POST `/analytics/v1/events`.
3. `@crewcue/map-core` owns GPX/KML normalization; mobile resolves package via built `dist/` (no `paths` to map-core `src` — Metro cannot resolve emitted `.js` re-exports from TS source).
4. Web (`apps/web`) and mobile Map Workspace: layers, uploads, toggles, selection; Navigate: Drive/Hike, reroute when online, offline banner + frozen progression per plan.
5. Root **`npm run verify`** green (including mobile `expo export` and `verify:dual-client`).

## Delivered on branch (issue #201)

- **Spike / basemap:** MapLibre RN (Expo config plugin + dev-client workflow) + MapLibre GL JS web; MapTiler-style URL helpers; CI placeholders.
- **Contracts + API:** `RaceMapWorkspace`, zod-validated persistence on race room; merge rules for checkpoints / optional baseline sync from primary layer.
- **map-core:** Shared parse + workspace layer normalization; API + mobile consume; tests in package.
- **Phase A UI:** `MapWorkspace` on web + mobile wired to API; GPX/KML upload flows.
- **Phase B:** `NavigateScreen` with OSRM-backed routing proxy; NetInfo reachability; hike/drive modes + fallback messaging hooks.
- **Phase C:** Offline corridor helpers + OfflineManager wiring pattern; settings entitlement toggle (`offlineMaps` preference); `emitAnalytics` → ingest API; typed event names per plan inventory where wired.
- **Tooling:** `scripts/verify-dual-client-architecture.mjs` extended to web `src/api/client.ts`; root workspaces include `@crewcue/web`; `.gitignore` includes `*.tsbuildinfo`.

## Next 1-3 tasks

1. Wait for **GitHub Actions** on PR #202; fix any CI drift (secrets/schema).
2. **Manual QA:** iOS/Android dev client — MapLibre native module, workspace sync, Navigate online/offline transitions, offline download gated by entitlement toggle.
3. **Docs/runbook:** Document `OSRM_ROUTER_BASE_URL`, MapTiler keys, and analytics ingest auth expectations for staging operators.

## Validation summary

- `npm run verify` (root): **pass** on `feature/maps-navigation-plan` after Metro fix (`@crewcue/map-core` via `dist/`), analytics import fix (`../api/client` not `client.js`), and removing committed `tsconfig.tsbuildinfo`.

## Open risks/blockers/questions

- OSRM demo host rate/availability vs production routing vendor terms (Phase B plan noted vendor validation).
- Physical-device behavior for OfflineManager tile budgets and entitlement UX needs field tuning.
- `dual-client-architecture-guardrails.md` not updated in this slice — refresh if reviewers want explicit `apps/web` networking diagram.

## Guardrails

- Keep layering: contracts → api → client/sync → UI → docs.
- Centralize HTTP in each client `src/api/client.ts` per dual-client guard.
- Do not commit secrets; CI uses placeholder env vars only.

## Successor prompt

```text
PR #202 (branch feature/maps-navigation-plan): confirm CI green; run dev-client smoke on iOS/Android for Map workspace + Navigate + offline banner.
If checks fail, fix and push. After merge, close loop on runbook env vars for OSRM + MapTiler + analytics.
```
