# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-07 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-084b`
- **Issue:** none created for this automation run.
- **PR:** pending — stale chat key / webhook security fixes.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Fixed backup restore so stale server backups cannot downgrade newer local room keys before the next backup upload.
- Fixed client room-key sync so envelopes below `latestRoomKeyVersion` are ignored and do not block deterministic fresh-key distribution after rotation.
- Fixed API key-envelope upload so stale envelope versions below the room's latest key version are rejected with 409.
- Fixed `/chat/push/webhook` so Stream push webhooks require matching `X-Api-Key` and `X-Signature` HMAC over the raw request body.
- Touched: `packages/chat-crypto/src/{identity,roomKey,roomKey.test}.ts`, `services/api/src/routes/chatRoutes{,.test}.ts`, `services/api/package.json`, `package-lock.json`, this handoff.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (10 tests).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run typecheck -w @crewcue/api` — pass.
- `npm run test:memory -w @crewcue/api` — pass (111 tests: 108 pass, 3 skipped).
- `npm run verify` — pass, including workspace tests/builds and mobile Expo export.

## Next 1-3 tasks

1. Open PR for `cursor/critical-bug-investigation-084b` and confirm CI green.
2. Follow-up hardening: decide whether identity registration should fetch/decrypt backup before upserting a new public key on backup decrypt failure.
3. Continue separate critical review of API idempotency partial-failure/retry paths.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- Deterministic distributor still uses the lexicographically first remaining member with a matching public key; if that member never syncs, others return `syncing` rather than risk conflicting fresh keys.
- No iOS simulator run: no `apps/mobile/**` UI or mobile-visible navigation changes.

## Successor prompt

```text
On cursor/critical-bug-investigation-084b, stale chat key restore/envelope downgrade and unsigned Stream push webhook fixes are implemented and `npm run verify` passes. Open/monitor the PR, then continue optional hardening of backup decrypt-failure identity registration and API idempotency retry paths.
```
