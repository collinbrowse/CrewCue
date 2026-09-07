# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-07 (UTC)
- **Roadmap phase:** Regression coverage automation.
- **Branch / PR:** `cursor/missing-test-coverage-5ffa` -> PR pending.
- **Active next:** Review/merge this coverage PR after CI is green.

## Completed

- Added API regression coverage for stale persisted `/race-rooms/mine` list hydration after a newer live stop-plan write.
- The test now proves the caller-visible room list retains the live `stopPlans` overlay before a subsequent write can mask stale-cache regressions.

## Next 1-3 tasks

1. Merge the coverage PR after CI is green.
2. Continue cron coverage inspection on future recent merged production changes.
3. Consider a separate API bug-fix issue for stale persisted list rows that no longer match live membership filters.

## Validation evidence

- `npm run test:memory -w @crewcue/api` passed.
- `npm run verify` passed.

## Open risks/blockers

- No issue was created for this cron task because this automation environment has no configured issue-creation tool and `gh` is read-only here.
- Potential follow-up: when persistence returns a stale member list row after a live membership removal, `/race-rooms/mine` may still include the stale persisted row; handle separately because it is a production behavior fix, not a pure coverage addition.

## Successor prompt

```text
Continue regression coverage automation from main. Prioritize recent merged production changes; avoid duplicating stop-plan stale-cache coverage added on cursor/missing-test-coverage-5ffa.
```
