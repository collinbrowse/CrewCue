# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-05-21 (UTC)
- **Branch:** `fix/primary-on-primary-contrast` (rebasing on `main` after #295 merge)
- **Issue:** [#292](https://github.com/collinbrowse/CrewCue/issues/292) — primary/onPrimary contrast
- **PR:** [#293](https://github.com/collinbrowse/CrewCue/pull/293) — open, conflicts resolved with `main`

## Completed (this session)

- **`onPrimary` theme token (#292):** pairs with `color.primary` (light `primary`, dark `primaryContainer`); fixes Kinetic light ~1.2:1 green-on-green.
- **Consumers:** `DSButton` primary, own chat bubbles, unseen chip, pace rail checkmark, readouts badge/save spinner.
- **Test:** `apps/mobile/src/design-system/themeContrast.test.ts` (WCAG AA ≥4.5:1 all systems/modes).
- **On `main`:** map peek sheet height fix ([#295](https://github.com/collinbrowse/CrewCue/pull/295) / #294) — merged; no code conflict with contrast branch.

## Validation evidence

- `npm run typecheck -w @crewcue/mobile` — pass (pre-merge with main)
- `node --import tsx --test src/design-system/themeContrast.test.ts` — pass
- Merge with `origin/main`: handoff-only conflict resolved
- iOS sim contrast check — not run

## Next 1-3 tasks

1. Merge PR #293 after CI green on updated branch.
2. Sim: Profile → Color mode primary buttons + own chat bubble text (Kinetic light).
3. Optional: Maestro smokes / map peek regression on guest map (`crewcue://guest`).

## Open risks/blockers

- Dark mode `onPrimary` uses `onPrimaryContainer` when `primary` maps to container — intentional; test enforces pairing.
- Untracked: `apps/mobile/.maestro/`, `docs/sdlc/plans/`.

## Successor prompt

```text
PR #293 fix/primary-on-primary-contrast: merged main (post #295). Push conflict resolution, confirm CI green, merge Closes #292. Optional iOS sim: Profile color-mode buttons + own chat bubbles (Kinetic light).
```
