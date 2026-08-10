# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-10 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/missing-test-coverage-6d71` from `main` @ `e0d1578`.
- **Active PR/issue:** Coverage PR pending/open from this branch; no issue created because this automation has read-only `gh` and no issue-create MCP tool.
- **Acceptance:** deterministic tests for meaningful recent regression risk; no production behavior changes.

## Completed

- Added mobile unit coverage for chat older-history paging (`queryOlderMessagesBefore`): default page size, explicit page size, `id_lt` query shape, and omitted Stream `messages` fallback.
- Included `src/features/chat/chatHistoryPaging.test.ts` in `@crewcue/mobile`'s test script.
- Existing state: #327 merged per-message read receipts and older-history scroll preservation; staging deploy/signed-in smoke remain outstanding.

## Validation evidence

- `npm run test -w @crewcue/mobile` — pass (117 tests).
- `npm run verify` — pass (lint, typecheck, tests, mobile startup smoke, workspace builds including Expo export).
- `npm run agent:ios:ready` — blocked on this Linux cloud host: `agent:ios:ready requires macOS`.

## Next 1-3 tasks

1. Review/merge the coverage PR after CI; create/link a GitHub issue before merge if required by repo policy.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging: send + photo; peer read -> receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- iOS simulator proof is unavailable in this Linux cloud run; rerun `npm run agent:ios:ready` + XcodeBuildMCP on macOS if PR reviewers require simulator evidence for this test-only mobile change.
- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.

## Successor prompt

```text
Coverage PR on cursor/missing-test-coverage-6d71 adds chatHistoryPaging tests and passed npm run verify. CI/review it, link an issue if needed, then continue staging deploy + signed-in chat smoke for #327.
```
