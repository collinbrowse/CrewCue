# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-05-21 (UTC)
- **Branch:** `fix/primary-on-primary-contrast`
- **Issue:** [#292](https://github.com/collinbrowse/CrewCue/issues/292) — primary/onPrimary contrast
- **PR:** [#293](https://github.com/collinbrowse/CrewCue/pull/293) — open

## Completed (this session)

- **`onPrimary` theme token:** pairs with `color.primary` (light `primary`, dark `primaryContainer`); fixes Kinetic light ~1.2:1 green-on-green.
- **Consumers:** `DSButton` primary, own chat bubbles, unseen chip, pace rail checkmark, readouts badge/save spinner.
- **Test:** `apps/mobile/src/design-system/themeContrast.test.ts` (WCAG AA ≥4.5:1 all systems/modes).

## Validation evidence

- `npm run typecheck -w @crewcue/mobile` — pass
- `node --import tsx --test src/design-system/themeContrast.test.ts` — pass
- iOS sim visual check — not run (UI-only token wiring)

## Next 1-3 tasks

1. Merge PR #293 after CI green; optional iOS sim checks in PR test plan.
2. Sim: Profile → Color mode primary buttons + own chat bubble text (Kinetic light).
3. Optional: Maestro smokes / deeplink re-check from prior handoff.

## Open risks/blockers

- Dark mode uses `onPrimaryContainer` for `onPrimary` token when `primary` maps to container — intentional; test enforces pairing.
- Untracked: `apps/mobile/.maestro/`, `docs/sdlc/plans/practical-e2e-crew-chat.md`.

## Successor prompt

```text
Branch fix/primary-on-primary-contrast: commit, PR Closes #292, npm run verify, iOS sim check Profile color-mode buttons + own chat bubbles (Kinetic light).
```
