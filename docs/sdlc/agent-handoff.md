# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-12 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `main` @ `e0d1578` (#331 handoff; #327 chat receipts on main).
- **Active follow-up:** Merge open critical draft #353 (ping authz + stale recordedAt); staging chat smoke.

## Completed

- Critical bug hunt 2026-08-12: re-verified top unmerged criticals still present on main; **no new high-confidence critical** warranting a duplicate PR.
- Confirmed still open/unmerged: #353 (supersedes #347/#349), plus #334–#344 backlog.
- Merged earlier: #327 read receipts; #324 plaintext chat; #325 push webhook auth; #304/#312 idempotency; #322 env switch.

## Next 1-3 tasks

1. Review/merge #353 (`cursor/critical-bug-investigation-d363`) — athlete-only pings + `stale_recorded_at`; close #347/#349 as superseded.
2. Staging deploy + signed-in chat smoke when Auth0 allows.
3. Next preferred draft after #353: #344 (chat outbox RMW) or #342 (join membership LWW) — do not reopen blindly.

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Many prior critical-bug draft PRs still open/unmerged (#334–#353 cluster).
- Deferred (not fixed): HTTP idempotency stolen lease after 5m; Stream `u-…` vs Auth0 push id mismatch; invite-accept can demote `athleteId` role (PATCH blocks this; invite does not).

## Successor prompt

```text
No new critical from 2026-08-12 hunt. Prefer merge #353 (ping authz + stale recordedAt); close #347/#349. Then #344 or #342. Do not reopen existing drafts blindly.
```
