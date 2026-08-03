# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-03 (UTC)
- **Roadmap phase:** MVP chat reliability / API durable membership correctness.
- **Branch:** `cursor/critical-bug-investigation-bbb7` → PR #341 (persist-before-memory for race room saves).
- **Active follow-up:** Land #341; triage open drafts #334–#340.

## Completed

- Critical bug hunt 2026-08-03: `saveRaceRoom` / `saveRaceRoomInvite` updated in-memory maps before durable persist. On Postgres persist failure, join-by-code left a ghost membership in-process, so retries returned 200 without writing membership — restart dropped the join. Fixed: persist first, then cache; invite path same ordering. Regression: `join-by-code does not keep ghost membership when room persist fails`.
- Prior open drafts unchanged: #340 sync outbox merge; #339 hydrate race; #338 course wipe-before-save; #337 orphan create; #336 manual-stop; #335 chat outbox; #334 sign-out wipe.

## Next 1-3 tasks

1. Merge/review #341 (persist-before-memory / ghost membership).
2. Prioritize landing API data-loss drafts (#338/#339) then mobile (#334/#335/#340).
3. Staging deploy + signed-in chat smoke (prior handoff).

## Open risks/blockers

- Concurrent join-by-code last-write-wins membership loss still possible (separate from persist ordering).
- Chat `messageQueue` SecureStore RMW can still drop rapid double-enqueues (#340 left out of scope).
- Auth0 still blocks unattended sim chat E2E.

## Successor prompt

```text
#341 open (persist-before-memory). Do not reopen #334–#340. Next: land #338/#339 API drafts, or fix concurrent join membership merge / chat messageQueue RMW if still open.
```
