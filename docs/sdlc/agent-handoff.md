# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-02 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-6270` (base `main`).
- **Active follow-up:** Fix sync outbox clobber — commit processed batch without dropping concurrent enqueues.

## Completed

- Identified critical sync outbox data loss: `replaceOutbox(result.operations)` after `processOutboxBatch` overwrote ops enqueued during the batch.
- Added `mergeProcessedBatch` + `commitProcessedBatch` (locked mutate) and wired `App.tsx` processing/retry paths.
- Regression tests in `outboxMerge.test.ts` for concurrent-enqueue preserve and no-resurrect.

## Next 1-3 tasks

1. Open/land PR for outbox clobber fix; run `npm run test -w @crewcue/mobile` (or scoped outbox tests) + verify.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); confirm migrate logs.
3. Signed-in smoke on staging: chat send/photo + peer read receipt; sync outbox under concurrent task enqueue.

## Open risks/blockers

- Prior open critical drafts still unmerged: #334–#339 (sign-out clear, stuck chat outbox, duplicate visits, orphan room, wipe-before-save, hydrate race). Do not reopen.
- Auth0 still blocks unattended sim chat E2E.
- Deferred candidates: join-by-code false-200 after persist fail / concurrent membership last-write-wins; chat messageQueue RMW races.

## Successor prompt

```text
Land outbox clobber fix on cursor/critical-bug-investigation-6270. Then prioritize merging #338/#339 (API data-loss) before staging soak.
```
