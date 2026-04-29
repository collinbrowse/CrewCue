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
- Branch: `feature/issue-183-onboarding-login-demo`
- Active PR: pending creation (`Closes #183`)
- Active issue: #183 (Sprint 1: Onboarding + normal login demo flow)
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

1. Implemented first-run onboarding flow in `apps/mobile/src/navigation/GuestHomeScreen.tsx` with persisted completion state and demo-focused copy.
2. Improved auth reliability in `apps/mobile/src/auth/useAuth.ts` by rejecting expired stored sessions, clearing stale tokens, and handling sign-in attempts before Auth request initialization.
3. Added focused auth session-restore coverage in `apps/mobile/src/auth/sessionRestore.ts` + `apps/mobile/src/auth/useAuth.test.ts`, and wired test execution in `apps/mobile/package.json`.
4. Ran validation for touched scope and full repo verify (`npm run test -w @crewcue/mobile`, `npm run typecheck -w @crewcue/mobile`, `npm run verify`).

## Next 1-3 tasks

1. Merge PR for #183 after review/checks, then move #183 to Done in project board.
2. Start next Sprint 1 demo issue: #184 (GPX import -> expected split times) with issue-linked PR.
3. Keep non-demo scope in Backlog (roadmap/spec), do not expand sprint scope ad hoc.

## Validation summary

- `npm run test -w @crewcue/mobile`: pass
- `npm run typecheck -w @crewcue/mobile`: pass
- `npm run verify`: pass

## Open risks/blockers/questions

- Auth0 callback/logout URL configuration must remain aligned with `crewcue://auth`; otherwise login retry guidance is shown but sign-in still fails.
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
After #183 merges, start #184 (GPX import -> expected split times), implement the largest safe complete slice, run npm run verify, and open/update a PR with Closes #184 and full required template sections.
```
