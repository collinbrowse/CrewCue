# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-09-03 (UTC)
- **Roadmap phase:** Coverage automation for recent merged GPX/mobile setup behavior.
- **Branch / PR:** `cursor/missing-test-coverage-73bc-strava-sports` -> PR pending.
- **Active issue:** Not created; automation has no issue-creation MCP tool and `gh` write operations are disallowed in this environment.
- **Active next:** Open PR, let CI run, and fill linked issue if one is created manually before merge.

## Completed

- Added regression coverage for the GPX import screen state helper so room hydration cannot overwrite a locally selected unsaved route file.
- Extracted GPX import display-state selection into `apps/mobile/src/features/gpx/courseImportState.ts` for deterministic unit coverage.

## Next 1-3 tasks

1. Review/merge the coverage PR after CI is green.
2. If repository policy requires an issue before merge, create one manually and add the `Closes #...` line to the PR body.
3. Re-run iOS simulator proof on macOS if this UI-adjacent state coverage needs manual confirmation.

## Validation evidence

- `npm run test -w @crewcue/mobile` passed.
- `npm run typecheck -w @crewcue/mobile` passed.
- `npm run verify` passed.
- `npm run agent:ios:ready` failed on Linux with `agent:ios:ready requires macOS`.

## Open risks/blockers

- iOS simulator validation is blocked by the Linux host. Options: run `npm run agent:ios:ready` and simulator QA on macOS, add a non-simulator E2E harness for this state transition, or accept focused unit coverage for this non-rendering helper refactor.

## Successor prompt

```text
Review PR for GPX import state coverage. If needed, create/link a GitHub issue, rerun iOS simulator QA on macOS, and merge after CI is green.
```
