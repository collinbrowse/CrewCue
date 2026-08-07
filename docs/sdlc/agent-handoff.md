# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-07 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/missing-test-coverage-54e3` from `main` @ `e0d1578`.
- **Active follow-up:** Coverage PR pending for chat push webhook auth boundaries; no GitHub issue was created because this automation environment has read-only `gh` and no issue-creation MCP tool.

## Completed

- Added API regression coverage for `/chat/push/webhook` forged sender rejection: an authenticated caller cannot dispatch as another room member without the shared secret.
- Added API regression coverage for trusted server fanout: wrong secret rejects, valid `CHAT_PUSH_WEBHOOK_SECRET` allows unauthenticated fanout, sender membership is still enforced, and token metadata remains hidden.
- Validation: `npm run test:memory -w @crewcue/api` passed (109 passed, 4 skipped); `npm run verify` passed.

## Next 1-3 tasks

1. Open/merge the coverage PR after review and green CI.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging: send + photo; peer read → receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.
- If server-to-server push fanout is used, staging/prod must set `CHAT_PUSH_WEBHOOK_SECRET`.

## Successor prompt

```text
Review coverage branch cursor/missing-test-coverage-54e3. After merge, deploy staging (confirm 0014), smoke signed-in chat send/photo/read receipt/older-scroll, and set CHAT_PUSH_WEBHOOK_SECRET if server fanout is enabled.
```
