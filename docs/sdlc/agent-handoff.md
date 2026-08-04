# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-04 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-8c04` (base `main`).
- **Active follow-up:** Merge concurrent join-by-code membership fix; staging smoke still pending from prior handoff.

## Completed

- Confirmed critical concurrent join-by-code last-write-wins membership loss; fixed via merge-on-write (`upsertRaceRoomMembership` / `upsertPersistedRaceRoomMembership` with FOR UPDATE + memory write queue). Invite-accept uses the same path.
- Evaluated deferred candidates (idempotency lease reclaim, platform events authz, chat outbox RMW, own `message.new` skip) — see hunt notes / PR.
- Do not reopen drafts #334–#341.

## Next 1-3 tasks

1. Open/link GitHub issue for concurrent join membership loss; merge this PR after CI green.
2. Deploy staging API; signed-in chat smoke (send/photo/read receipts) still outstanding from #327.
3. Optionally harden HTTP idempotency lease ownership (stolen-lease duplicate side effects after 5m).

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Other room PATCH/DELETE membership paths still full-document RMW (join/invite accept fixed).
- Staging DB must get migration 0014 via Railway deploy (prior).

## Successor prompt

```text
PR for concurrent join-by-code membership merge-on-write on cursor/critical-bug-investigation-8c04. Link issue, ensure CI green, merge. Then staging deploy + chat smoke. Optional: lease-owner-scoped httpIdempotency reclaim.
```
