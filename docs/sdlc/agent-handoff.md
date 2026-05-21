# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-05-21 (UTC)
- **Branch:** `fix/map-sheet-peek-height`
- **Issue:** [#294](https://github.com/collinbrowse/CrewCue/issues/294) — map peek sheet empty space
- **PR:** (open after push) — map bottom sheet peek height

## Completed (this session)

- **Map peek sheet (#294):** measure handle + peek chrome via `onLayout`; shrink `sheetBoxHeight` when fully peeked; unmount checklist `ScrollView` in peek; tighter peek padding.
- Layout is content-driven (not simulator-specific).

## Validation evidence

- `npm run verify` — pass
- iOS sim guest map (`crewcue://guest`) — peek sheet flush below stats; user confirmed

## Next 1-3 tasks

1. Merge PR after CI green.
2. Optional: Maestro smoke for map peek layout on second simulator size.
3. Separate: PR #293 `fix/primary-on-primary-contrast` if still open.

## Open risks/blockers

- `minPeek: 120` could add small gap if chrome ever shorter than 120px (unlikely).
- Untracked: `apps/mobile/.maestro/`, `docs/sdlc/plans/`.

## Successor prompt

```text
Branch fix/map-sheet-peek-height: merge PR Closes #294. Optional sim pass on SE + Pro Max peek sheet. Check status of fix/primary-on-primary-contrast PR #293.
```
