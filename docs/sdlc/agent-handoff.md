# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-15 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / regression test coverage automation.
- **Branch:** `cursor/missing-test-coverage-401e`
- **Issue:** none created; automation has read-only `gh` guidance and no issue-creation MCP tool.
- **PR:** pending for this branch.
- **Acceptance criteria:** inspect recent merged code; add focused deterministic tests for risky missing coverage; avoid production behavior changes except tiny testability refactor; run relevant validation.

## Completed (this session)

- Added a Stream client factory hook in `services/api/src/lib/streamChannelMembers.ts` so tests can exercise Stream channel sync without network calls.
- Added `services/api/src/lib/streamChannelMembers.test.ts` covering roster user upsert, display-name trimming, duplicate member dedupe, stale Stream member removal, duplicate-channel create tolerance, and the empty-snapshot no-remove guard.
- Extended `services/api/src/routes/chatRoutes.test.ts` to cover `/chat/rooms/:roomId/sync-stream-channel` auth, missing Stream config, room not found, non-member rejection, and successful member sync.
- Do-not-change guardrails honored: no API contract changes, no persistence behavior changes, no mobile/web UI changes, no staging/cloud changes.

## Validation evidence

- `npm run typecheck -w @crewcue/api` — pass.
- `npm run test:memory -w @crewcue/api` — pass (114 tests, 111 pass, 3 skipped).
- `npm run verify` — pass.
- Initial validation attempt failed because dependencies were missing (`tsc: not found`); `npm ci` from lockfile resolved the environment setup.

## Next 1-3 tasks

1. Open the PR for `cursor/missing-test-coverage-401e`.
2. Confirm PR CI is green after opening.
3. Future coverage candidate: mobile `apps/mobile/src/features/chat/chatKeySync.ts` (requires iOS simulator proof if touched).

## Open risks/blockers

- No GitHub issue was created for this automation run due tool availability; PR body must note this instead of using an invalid `Closes #`.
- No iOS simulator run: API-only tests changed, not mobile UI.

## Successor prompt

```text
On branch cursor/missing-test-coverage-401e, Stream channel member sync coverage was added for API helper and route paths. Scoped API typecheck, API memory tests, and npm run verify pass. Open/monitor the PR and note no issue was created because the automation lacks an issue-creation tool.
```
