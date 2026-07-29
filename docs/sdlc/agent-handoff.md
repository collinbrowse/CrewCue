# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-29 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-381a` (create-room orphan fix).
- **Active follow-up:** Merge this PR; prior drafts #334/#335/#336 still open.

## Completed

- Critical bug hunt: `POST /race-rooms` released the idempotency lease after `saveRaceRoom` if `completeIdempotentMutation` failed; mobile retries with the same key created a second room. Fixed with deterministic room ids + existing-room reclaim + no release after persist.
- Prior open drafts unchanged: #336 manual-stop overlap; #334 sign-out wipe; #335 outbox reclaim.

## Next 1-3 tasks

1. Review/merge create-room orphan fix PR from this hunt.
2. Deploy staging API + signed-in chat smoke (unchanged from #327 handoff).
3. Consider course PUT finally-release-after-save (lower blast radius; overwrite-ish).

## Open risks/blockers

- Drafts #334/#335/#336 still unmerged.
- Auth0 still blocks unattended sim chat E2E.
- Course update `finally` still releases after durable side effects on incomplete idempotency — not fixed here.

## Successor prompt

```text
Merge create-room orphan fix if CI green. Do not reopen #334/#335/#336. Optional: harden PUT /course release-after-save similarly. Staging chat smoke still pending.
```
