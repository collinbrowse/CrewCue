# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-08 (UTC)
- **Roadmap phase:** Regression coverage automation; MVP chat reliability still awaiting staging proof.
- **Branch/PR:** `cursor/missing-test-coverage-a93c` / #350.
- **Active follow-up:** Review env-switcher coverage PR; then staging deploy + signed-in chat smoke.

## Completed

- Added regression coverage for PR #322 env switcher: init seeding/alignment, staging activation/marker, Auth0 drift warnings, and invalid profile no-mutation behavior.
- Wired root `npm test` to run `npm run test:scripts` before workspace tests.
- Validation: `npm run test:scripts` passed (4 tests); `npm run verify` passed after `npm ci` restored locked dependencies.
- Earlier: #327 read receipts/older-history scroll, #324 plaintext chat, #325 push webhook auth, #304/#312 idempotency, #322 env switch.

## Next 1-3 tasks

1. Review/merge env-switcher coverage PR #350 from `cursor/missing-test-coverage-a93c`.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging (reload app from main): send + photo; peer read -> receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.
- No issue was created for this cron coverage run because this environment exposes read-only `gh` and no issue-creation MCP action.

## Successor prompt

```text
Review/merge env-switcher coverage PR #350. Then deploy staging (confirm 0014) and smoke chat send/photo, peer read receipt under own bubble, load-older scroll.
```
