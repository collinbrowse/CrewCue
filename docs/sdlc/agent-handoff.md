# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-21 (UTC)
- **Roadmap phase:** Dev ergonomics / local↔staging env switching (after MVP plaintext chat).
- **Branch:** `feature/env-local-staging-switch-321`
- **Issue:** #321
- **PR:** #322
- **Acceptance criteria:** env:local/staging/status/init; Auth0-aligned API profiles; runbook docs; machine profiles seeded (gitignored).

## Completed

- Merged #324 plaintext chat; #325 push webhook auth; #304 platform event idempotency conflicts; #312 stale idempotency lease reclaim.
- Closed obsolete Bugbot coverage PRs (#307/#309/#314/#316/#318–#320).
- On this PR: `scripts/switch-dev-env.mjs` + `env:init|local|staging|status`; example profiles; API root `.env` load; Auth0 runbook updates.

## Next 1-3 tasks

1. Finish rebase of #322 onto main; push; confirm CI green; merge.
2. Deploy staging API (Railway migrate 0014) + signed-in chat smoke.
3. Configure `CHAT_PUSH_WEBHOOK_SECRET` if server-to-server push fanout cannot use sender JWT.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Staging DB must get migration 0014 via Railway deploy.
- “Local Auth0” reuses the staging Auth0 tenant by default; each clone needs `npm run env:init`.

## Successor prompt

```text
#322 rebased onto main (env local/staging switch). Confirm CI, merge. Then staging deploy + chat smoke; use npm run env:local for local API work.
```
