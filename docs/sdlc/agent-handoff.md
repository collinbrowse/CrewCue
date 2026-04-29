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
- Branch: `main`
- Active PR: none
- Active issue: none (sprint issues are open under Epic A)
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

## Next 1-3 tasks

1. Start the highest-priority open Sprint 1 issue from Epic #182 and move it to `In progress` in the GitHub Project.
2. Ship as small issue-linked PRs (`Closes #...`) with `npm run verify` green before merge.
3. Keep non-demo scope in Backlog (roadmap/spec), do not expand sprint scope ad hoc.

## Guardrails

- Keep layering: contracts -> api -> client/sync -> UI -> docs.
- Do not duplicate API client/outbox execution paths.
- Keep server state authoritative; UI state is derived/intent/ephemeral only.
- Keep docs concise; completed history lives in `docs/sdlc/archive-completed-work-summary.md`.

## Successor prompt

```text
Continue CrewCue on Epic A Sprint 1 (demo-first).
Read: agent-handoff.md -> README.md -> token-budget.md -> mvp-ui-development-spec.md -> ui-delivery-roadmap-and-spec.md.
Pick one open Sprint 1 issue under Epic #182, set project status to In progress, implement with minimal scope, run npm run verify, and open/update PR with Closes #issue.
```
