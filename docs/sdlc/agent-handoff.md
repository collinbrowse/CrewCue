# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-13 (UTC)
- **Roadmap phase:** Crew schedule + AI pacing — Wave 2 in progress.
- **Branch / PR:** W2-1 [#385](https://github.com/collinbrowse/CrewCue/pull/385) merged (`Closes #383`).
- **Active:** Parallel W2-2 [#386](https://github.com/collinbrowse/CrewCue/issues/386) (notify) and W2-3 [#387](https://github.com/collinbrowse/CrewCue/issues/387) (mobile check-in).

## Completed

- Wave 0–1; W2-1 check-in → reproject schedule ETAs (#383 / #385). Staff review fixed LWW closed-actual selection (no double-shift).

## Next 1-3 tasks

1. Execute W2-2 #386 (push/chat notify on material ETA shift).
2. Execute W2-3 #387 (mobile check-in + schedule refresh) in parallel.
3. After both merge, run W2-I integration.

## Open risks/blockers

- GET `/schedule` may 503 if projection hydrate fails — clients should degrade gracefully.
- Arrival-only HTTP check-in still 400; closed visits need arrival+departure.
- Authed Pace E2E still needs a test account; prefer DEV deeplink for mobile sim.

## Successor prompt

```text
Execute #386 (W2-2 notify) and/or #387 (W2-3 mobile check-in) in parallel. Do not edit agent-handoff.md. Do not merge your own PRs.
```
