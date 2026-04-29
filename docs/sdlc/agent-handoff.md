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

- Last updated: 2026-04-29 (UTC-6)
- Branch: `feature/issue-187-gpx-import-splits`
- Active PR: none
- Active issue: #184 (Sprint 1: Crew creation + member invite workflow)
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

1. Implemented Sprint 1 issue #184 end-to-end invite workflow:
   - added API `GET /race-rooms/:roomId/invites` listing route with persisted status hydration,
   - added mobile API client methods for `issueInvite` and `getInvites`,
   - wired shell state/actions (`invites`, `onIssueInvite`, `onFetchInvites`) in `apps/mobile/App.tsx` + context.
2. Added in-app invite UX on `AuthenticatedOperateScreen`:
   - email input + role picker + send invite action,
   - explicit role-aware disabled reason for unauthorized invite senders,
   - visible pending invite list + current membership list with refresh action.
3. Added tests for new invite list and mobile invite client paths.

## Next 1-3 tasks

1. Open PR for #184 with required template sections and `Closes #184`.
2. Run full repo `npm run verify` before merge.
3. Start next Epic A Sprint 1 issue after #184 PR is in review (shared notes flow).

## Validation summary

- `npm test -w @crewcue/mobile -- src/api/client.test.ts`: pass
- `npm test -w @crewcue/api -- src/routes/raceRooms.test.ts`: pass
- `npm run typecheck -w @crewcue/mobile`: pass
- `npm run typecheck -w @crewcue/api`: pass

## Open risks/blockers/questions

- Invite list is currently broad to any room member (read visibility), while send remains role-gated; tighten if product decides invite visibility should be restricted.
- Final on-device visual smoke is still recommended before merge for issue #184.
- Existing unstaged user change remains in `docs/sdlc/mvp-ui-development-spec.md` (left untouched).

## Guardrails

- Keep layering: contracts -> api -> client/sync -> UI -> docs.
- Do not duplicate API client/outbox execution paths.
- Keep server state authoritative; UI state is derived/intent/ephemeral only.
- Keep docs concise; completed history lives in `docs/sdlc/archive-completed-work-summary.md`.

## Successor prompt

```text
Continue CrewCue on Epic A Sprint 1 (demo-first).
Read: agent-handoff.md -> README.md -> token-budget.md -> mvp-ui-development-spec.md -> ui-delivery-roadmap-and-spec.md.
Complete PR lifecycle for #184 (required template sections + Closes #184 + checks review).
Then start the next Sprint 1 issue with highest demo value (shared crew notes flow).
```
