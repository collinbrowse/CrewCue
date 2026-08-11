# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-11 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch/PR:** `cursor/missing-test-coverage-14ab` / PR #354.
- **Active follow-up:** Open coverage PR; staging deploy + signed-in chat smoke still remain.
- **Acceptance criteria:** deterministic tests cover risky recent chat history paging behavior; no production behavior change; relevant validation passes.

## Completed

- Added `apps/mobile/src/features/chat/chatHistoryPaging.test.ts` for older-history paging query shape:
  default/custom page size, `id_lt` oldest-visible cursor, `"current"` Stream state mode, and missing `messages` empty-page fallback.
- Wired the new test into `@crewcue/mobile` test script.
- Validation passed: `npm run test -w @crewcue/mobile`; `npm run typecheck -w @crewcue/mobile`; `npm run verify`.

## Next 1-3 tasks

1. Monitor PR #354; link an issue manually if project workflow requires one.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging (reload app from main): send + photo; peer read -> receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- GitHub issue was not created by this automation: `gh` is read-only here and no issue-creation MCP tool is available.
- Auth0 still blocks unattended sim chat E2E; this coverage PR changes tests/package script only, not mobile UI behavior.
- Staging DB must get migration 0014 via Railway deploy; Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.

## Successor prompt

```text
Coverage PR #354 adds mobile chat older-history paging tests and passes mobile tests/typecheck + root verify. Monitor PR; if continuing product work, deploy staging 0014 and smoke signed-in chat receipts/history.
```
