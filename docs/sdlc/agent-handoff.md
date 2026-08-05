# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-05 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — regression coverage + staging proof.
- **Branch:** `cursor/missing-test-coverage-c0b4` (#345) from `main` @ `e0d1578`.
- **Active follow-up:** Review/merge #345; staging deploy + signed-in chat smoke remain.

## Completed

- Coverage automation #345: added API regression coverage proving chat retention purges only eligible-room notification prefs, reports the purge count, and preserves prefs for ineligible rooms.
- Validation: `npm run test:memory -w @crewcue/api` passed; `npm run verify` passed. Initial validation required `npm ci` because the cloud image lacked `tsc`.
- Merged #327: per-message “Read by everyone” under own bubbles; live `message.read` updates; older-history scroll preserve; idle roster members without read state do not block receipts.
- Earlier: #324 plaintext chat; #325 push webhook auth; #304/#312 idempotency; #322 env switch; obsolete Bugbot coverage PRs closed.

## Next 1-3 tasks

1. Review/merge #345 after GitHub checks pass.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging (reload app from main): send + photo; peer read → receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- Coverage automation has no issue-creation MCP tool and `gh` is read-only in this environment, so this PR is not linked to a newly created issue.
- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.

## Successor prompt

```text
#345 on cursor/missing-test-coverage-c0b4 adds chat retention preference-purge tests; verify checks and merge. Then deploy staging (confirm 0014), reload mobile from main, and smoke chat send/photo/read receipt/load-older scroll.
```
