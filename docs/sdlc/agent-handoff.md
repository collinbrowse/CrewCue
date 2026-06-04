# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-04 (UTC)
- **Branch:** `cursor/missing-test-coverage-2a80`
- **Issue:** none created in this run (GitHub CLI is read-only in this environment)
- **PR:** pending

## Completed (this session)

- Added chat route regression coverage in `services/api/src/routes/chatRoutes.test.ts`.
- Covered identity lookup permission boundaries: self/shared-room members allowed, outsider denied.
- Covered owner-only chat data purge: crew member denied, owner purge removes key envelopes and notification prefs.
- Commit pushed: `e968fd4` (`test(api): cover chat identity and purge permissions`).

## Validation evidence

- `npm run test:memory -w @crewcue/api` — pass (`111` tests, `fail 0`; new chat tests `ok 42`, `ok 45`).
- `npm run verify` — pass; includes workspace lint/typecheck/tests/smoke/build.

## Next 1-3 tasks

1. Open PR for `cursor/missing-test-coverage-2a80` and wait for CI.
2. If CI differs from local verify, inspect failed job logs and patch on the same branch.
3. Continue future coverage automation with recent merged API/mobile code paths that changed production behavior without tests.

## Open risks/blockers

- No production behavior changed.
- Could not create/link a GitHub issue because the available `gh` CLI is read-only and no issue-creation tool is available.
- `npm ci` reported existing dependency audit findings; not related to this test-only change.

## Successor prompt

```text
Coverage PR on cursor/missing-test-coverage-2a80: chat route tests added for identity lookup permissions and owner-only chat data purge. Local `npm run test:memory -w @crewcue/api` and `npm run verify` pass. Monitor PR CI; if green, merge per repo process.
```
