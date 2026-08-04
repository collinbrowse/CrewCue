# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-04 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging; regression coverage hardening continues in parallel.
- **Branch:** `cursor/missing-test-coverage-20b4` @ `d303474`.
- **Active follow-up:** PR #343 covers env-switch regression tests; no issue created because this automation has read-only `gh` and no issue-creation tool.

## Completed

- Added coverage branch commit `d303474`: root `test:scripts` target plus `scripts/switch-dev-env.test.mjs` covering env profile init, Auth0 alignment, profile activation, mismatch warnings, and invalid profile rejection.
- Validation passed: `npm run test:scripts`, `npm run test`, `npm run verify` (after `npm install` restored missing workspace dev tools).
- Merged #327: per-message “Read by everyone” under own bubbles; live `message.read` updates; older-history scroll preserve; idle roster members without read state do not block receipts.
- Earlier: #324 plaintext chat; #325 push webhook auth; #304/#312 idempotency; #322 env switch; obsolete Bugbot coverage PRs closed.

## Next 1-3 tasks

1. Review/merge PR #343 once CI is green.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging (reload app from main): send + photo; peer read → receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- No GitHub issue was created for this automation run because available `gh` usage is read-only and no issue MCP tool exists.
- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.

## Successor prompt

```text
Review PR #343 from `cursor/missing-test-coverage-20b4`; if green, merge. Then deploy staging (confirm 0014) and smoke signed-in chat send/photo/read receipt/load-older scroll.
```
