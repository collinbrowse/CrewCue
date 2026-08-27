# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/agent-async-delivery-program.md` (crew schedule + AI pacing program)
6. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-27 (UTC)
- **Roadmap phase:** Mobile GPX import UX (#454); physiology micro-model (#451) still open on stashed branch.
- **Branch / PR:** `feature/gpx-splits-progress-bar` → issue #454.
- **Active next:** Open/merge PR #454; restore micro-model calibration stash on `feature/physiology-micro-model-estimator`.

## Completed

- #454: progress bar after course GPX select while splits calculate (`GpxImportScreen`, athlete wizard); DEV deeplink for sim QA.

## Next 1-3 tasks

1. Merge #454 after CI green.
2. Restore stash + finish micro-model calibration on physiology branch / PR #453.
3. Optional: expose XcodeBuildMCP `tap` tools (currently missing) for richer mobile agent QA.

## Validation evidence

- Mobile lint + tests green (incl. `courseImportProgress.test.ts`).
- Sim: `crewcue://course/dev-gpx-import-progress` shows progress bar (“Reading route file…” / Calculating…) — screenshots in PR (local `.agent-pr-evidence/`, not committed).
- XcodeBuildMCP `tap` not available; used deeplink + auto-run on focus.

## Open risks/blockers

- Production file-picker path still needs human Auth0 + Files UI; DEV deeplink covers progress bar itself.
- Micro-model calibration WIP is on git stash `wip: micro-model calibration`.

## Successor prompt

```text
Merge PR for #454 if open. Then: git checkout feature/physiology-micro-model-estimator && git stash pop; finish calibration commit/push for PR #453.
```
