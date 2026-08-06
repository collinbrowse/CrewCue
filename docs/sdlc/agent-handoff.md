# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-06 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) + regression coverage.
- **Branch:** `cursor/missing-test-coverage-9937` from `main` @ `e0d1578`.
- **Active follow-up:** Merge coverage PR, then continue staging deploy + signed-in chat smoke.

## Completed

- Added root script-test coverage for #322 env switching: init seeding, Auth0 issuer/audience alignment, staging activation copies/marker, mismatch warnings, and unknown-profile no-mutation behavior.
- Wired `npm test` to run `npm run test:scripts` before workspace tests.
- Validation: `npm run test:scripts`, `npm test`, and `npm run verify` passed after `npm ci` installed missing dev tools.
- Earlier: #327 per-message “Read by everyone” + older-history scroll preserve; #324 plaintext chat; #325 push webhook auth; #304/#312 idempotency.

## Next 1-3 tasks

1. Review/merge coverage PR for `cursor/missing-test-coverage-9937`.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging: send + photo; peer read → receipt under own bubble; scroll-up history stays anchored.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts.
- GitHub issue not created for this automation run because the available `gh` instructions are read-only and no issue-creation MCP tool is configured.

## Successor prompt

```text
Review/merge coverage PR from `cursor/missing-test-coverage-9937`; validation passed (`npm run verify`). Then resume staging deploy/signed-in chat smoke from #327.
```
