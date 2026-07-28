# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-28 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-0497` (manual-stop duplicate-visit fix).
- **Active follow-up:** Open PR for manual-stop overlap fix; merge #334/#335 when ready; staging chat smoke.

## Completed

- Critical bug hunt 2026-07-28: manual checkpoint stop overlap matched only `autoDetected`, so crash/retry after projection save (idempotency lease reclaim) appended a duplicate visit and double-counted stoppage. Fix: `findOverlappingCheckpointVisit` also matches prior `manualEntry` windows; unit + route regression tests.
- Prior open drafts (do not duplicate): #334 sign-out wipe; #335 outbox reclaim.

## Next 1-3 tasks

1. Review/merge manual-stop overlap PR on `cursor/critical-bug-investigation-0497`.
2. Deploy staging API; signed-in chat smoke (send/photo/read receipt/scroll).
3. Merge or land #334/#335 (cross-account wipe / stuck outbox send).

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- HTTP idempotency still releases after partial mutation on some paths (create-room); visit overlap fix covers manual-stop data corruption specifically.
- Staging DB must get migration 0014 via Railway deploy.

## Successor prompt

```text
Land manual-stop overlap PR if open. Prefer merge #334/#335 next. Staging deploy + chat smoke still pending from main.
```
