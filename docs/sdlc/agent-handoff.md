# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-05-21 (UTC)
- **Branch:** `main`
- **Issue:** [#290](https://github.com/collinbrowse/CrewCue/issues/290) — closed via PR
- **PR:** [#291](https://github.com/collinbrowse/CrewCue/pull/291) — **merged**
- **Prior:** [#289](https://github.com/collinbrowse/CrewCue/pull/289) practical E2E crew chat on `main`

## Completed (this session)

- **Deep linking fix (#291):** guest vs authed tab linking configs; defer/replay authed deeplinks (`crewcue://chat`, etc.); fixes unhandled `NAVIGATE` toast on guest root.
- Unit tests: `apps/mobile/src/navigation/linking.test.ts`.
- Local cleanup: on `main`, deleted merged branch `fix/chat-deeplink-linking-config`.

## Validation evidence

- PR #291 merged (`be6aceb`); Closes #290
- `npm run lint -w @crewcue/mobile` + linking tests — pass pre-merge
- iOS sim re-check after dev reload: confirm no RN toast on `crewcue://chat` (authed session)

## Next 1-3 tasks

1. **Sim:** Re-open `crewcue://chat` on authed simulator — confirm NAVIGATE toast gone post-merge.
2. **Optional:** Commit Maestro smoke flows under `apps/mobile/.maestro/` (currently local untracked) or add chat send flow.
3. **Optional:** `accessibilityLabel="Send"` on chat composer for XcodeBuildMCP label taps.

## Open risks/blockers

- Untracked local: `apps/mobile/.maestro/`, `docs/sdlc/plans/practical-e2e-crew-chat.md` — not on `main`; decide commit vs discard.
- Legacy chat ciphertext decrypt placeholder until room key re-wrap (ADR 0006).

## Successor prompt

```text
On main after #291: verify crewcue://chat deeplink on authed iOS sim (no NAVIGATE toast). Optionally PR Maestro smokes from apps/mobile/.maestro/.
```
