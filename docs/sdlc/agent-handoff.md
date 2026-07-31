# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-31 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-3e51` (course/map-workspace wipe-before-save fix).
- **Active follow-up:** Review/merge this PR; still open drafts #334–#337 (do not reopen).

## Completed

- Critical bug hunt 2026-07-31: course PUT + map-workspace wiped task/adaptive/sync payloads before `saveRaceRoom`; DB persist failure left boards destroyed while the room was unchanged. Fixed: persist first, then wipe; do not release course idempotency after durable save. Regression tests added.
- Prior open drafts unchanged: #337 orphan create rooms; #336 duplicate manual-stop; #335 outbox; #334 sign-out wipe.

## Next 1-3 tasks

1. Merge/review wipe-before-save fix on `cursor/critical-bug-investigation-3e51`.
2. Deploy staging API (Railway migrate `0014_drop_chat_crypto.sql`); signed-in chat smoke.
3. Triage open drafts #334–#337 for merge (highest severity remaining).

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- In-memory `raceRooms.set` still runs before `persistRaceRoom`; postgres failure can diverge memory vs DB (pre-existing).
- Open drafts #334–#337 not merged.

## Successor prompt

```text
Wipe-before-save course/map-workspace fix on cursor/critical-bug-investigation-3e51. Review PR; do not reopen #334–#337. Staging deploy + chat smoke still pending on main.
```
