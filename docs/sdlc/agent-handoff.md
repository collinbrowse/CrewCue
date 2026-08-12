# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-12 (UTC)
- **Roadmap phase:** Agent async delivery setup for crew schedule + AI pacing.
- **Branch / PR:** `docs/356-ultrapacer-competitive-analysis` (issue [#356](https://github.com/collinbrowse/CrewCue/issues/356)).
- **Active:** Open PR for #356; file epic + Wave 0 issues after push.

## Completed

- Competitive analysis + AI history pacing direction (`docs/competitive/ultrapacer-feature-gap-analysis.md`).
- Async agent program: `docs/sdlc/agent-async-delivery-program.md` (waves, Ready/Done, EC matrix, conflict map).
- Issue template: `.github/ISSUE_TEMPLATE/agent-work-package.yml`.
- Rule: `.cursor/rules/agent-work-package-verification.mdc`.

## Next 1-3 tasks

1. Merge #356 when CI green.
2. Launch W0-1 agent (contracts) from the Wave 0 issue.
3. After W0-1 merge, launch W0-2 (fixtures); Integration agent then unlocks Wave 1.

## Open risks/blockers

- Wave 0 child issue numbers filled after GitHub create (see PR comments if handoff lags).
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Watch #356 PR CI; merge when green. Then pick the W0-1 agent-ready issue (contracts DTOs) using docs/sdlc/agent-async-delivery-program.md kickoff prompt. Do not start W0-2 until W0-1 merges.
```
