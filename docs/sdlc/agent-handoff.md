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

- Last updated: 2026-04-30 (UTC-6)
- Branch: `feature/issue-194-race-room-roster-mobile`
- Active PR: (open after push) for #194
- Active issue: #194 (Race room roster: member PATCH/DELETE, display names, mobile workspace navigation)
- Current priority: demo-first **Epic A**
- Current sprint milestone: `Epic A Sprint 1 - Demo foundation`
- Epic tracker: #182

## Current objective

Deliver Sprint 1 demo flows:

1. onboarding + normal login
2. GPX import -> expected split times
3. crew creation + invites
4. shared crew notes
5. visual polish across demo-critical screens

## Completed in this session

1. **#194 — Race room roster (API + mobile):**
   - API: `PATCH /race-rooms/:roomId/members/:memberUserId` for owner role changes and self-only display name updates; `DELETE` for owner removing non-owner members; invariants for athlete owner.
   - Contracts: optional `displayName` on `RaceRoomMembership`.
   - Mobile API client: `updateRaceRoomMemberRole`, `updateRaceRoomMemberDisplayName`, `removeRaceRoomMember`.
   - Mobile UX: workspace menu, join room details, manage members, race picker overlay; operate shell + navigation wiring; Expo dev entry hardening (`SafeAreaProvider`, keep-awake noise); `scripts/mobile-expo-start.mjs` preloads `apps/mobile/.env` for `EXPO_PUBLIC_*` before Expo CLI.
2. Tests extended for new race room member routes.

## Next 1-3 tasks

1. Merge PR for #194 after CI green and review (`Closes #194` in PR body).
2. On-device smoke: workspace menu, member role/display name, remove member, join-by-code flow.
3. Continue Epic A Sprint 1 next highest-demo issue (e.g. shared crew notes) per roadmap.

## Validation summary

- `npm run verify` at repo root: run on PR branch before push (lint, typecheck, test, smoke:mobile:startup, build including mobile `expo export`).

## Open risks/blockers/questions

- Invite list visibility vs. send authz remains as prior handoff; product may tighten read scope later.
- Untracked local-only files at repo root (`App.tsx`, `tsconfig.json` re-export/tsconfig stubs) were **not** committed; adopt only if a deliberate root Expo entry is chosen.

## Guardrails

- Keep layering: contracts -> api -> client/sync -> UI -> docs.
- Do not duplicate API client/outbox execution paths.
- Keep server state authoritative; UI state is derived/intent/ephemeral only.
- Keep docs concise; completed history lives in `docs/sdlc/archive-completed-work-summary.md`.

## Successor prompt

```text
Continue CrewCue Epic A Sprint 1. Read agent-handoff.md -> README.md -> token-budget.md -> mvp-ui-development-spec.md -> ui-delivery-roadmap-and-spec.md.
If PR #194 is open: address review, keep `Closes #194`, ensure `npm run verify` is green.
Then pick the next Sprint 1 issue with highest demo value (e.g. shared crew notes).
```
