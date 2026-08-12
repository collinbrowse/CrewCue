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
- **Branch / PR:** `docs/356-ultrapacer-competitive-analysis` → [#357](https://github.com/collinbrowse/CrewCue/pull/357) (`Closes #356`).
- **Active:** Merge #357; then launch W0-1 #361.

## Completed

- Competitive analysis + AI history pacing direction (`docs/competitive/ultrapacer-feature-gap-analysis.md`).
- Async agent program + issue template + verification rule.
- Milestone [Crew schedule + AI pacing](https://github.com/collinbrowse/CrewCue/milestone/8); epic #360; W0-1 #361 (`agent-ready`); W0-2 #358; W0-3 #359 closed.

## Next 1-3 tasks

1. Merge #357 when CI green.
2. Launch W0-1 agent on #361 (contracts DTOs).
3. After #361 merges, add `agent-ready` to #358 and launch W0-2 fixtures.

## Open risks/blockers

- W0-1 should wait for #357 merge so program docs are on `main` (or branch from main after merge).
- Strava OAuth / AI model port still need staging secrets design in W3.

## Successor prompt

```text
Merge #357 when CI green. Then execute #361 (W0-1 contracts) using the issue kickoff prompt. Do not start #358 until #361 is on main; then add agent-ready and run W0-2.
```
