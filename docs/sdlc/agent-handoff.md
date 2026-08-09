# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-09 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) plus regression coverage hardening.
- **Branch/PR:** `cursor/missing-test-coverage-faca` / #351; base `main` @ `e0d1578`.
- **Active follow-up:** Review coverage PR #351, then staging deploy + signed-in chat smoke.

## Completed

- This run: added `services/api/src/lib/platformEventIdempotency.test.ts`.
- New coverage proves duplicate platform-event idempotency accepts semantically equivalent payload object key order and rejects conflict-relevant aggregate/event/schema/actor/correlation/causation/payload changes.
- Earlier: #327 chat read receipts/older-history scroll; #324 plaintext chat; #325 push webhook auth; #304/#312 idempotency; #322 env switch.

## Validation evidence

- `npm run test:memory -w @crewcue/api` passed.
- `npm run verify` passed.

## Next 1-3 tasks

1. Monitor/review PR #351; ensure linked issue is filled before merge if created manually.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging (reload app from main): send + photo; peer read -> receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- This automation has read-only `gh` guidance and no issue-creation MCP tool, so no GitHub issue was created for this coverage task.
- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.

## Successor prompt

```text
Coverage branch cursor/missing-test-coverage-faca adds API platform-event idempotency matcher tests and passes API memory + root verify. Review/merge PR, then deploy staging (confirm 0014) and smoke chat send/photo, peer read receipt, load-older scroll.
```
