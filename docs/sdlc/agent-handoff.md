# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-08 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) — prove on staging.
- **Branch:** `cursor/critical-bug-investigation-6f55` @ `e0d1578` (investigation; no code fix pushed).
- **Active follow-up:** Fix out-of-order athlete ping acceptance (see findings below), or continue staging smoke from prior handoff.

## Completed

- Critical bug hunt (skip open drafts #334–#348): traced race rooms pings/projection, invites, entitlements, platform idempotency, chat routes, mobile outbox/read receipts/env switch.
- Highest-confidence new finding: out-of-order `POST .../pings` accepted when `recordedAt` ≤ last accepted (skips motion check; regresses projection).

## Next 1-3 tasks

1. Fix ping ingest: reject stale/duplicate `recordedAt` ≤ `lastAccepted.recordedAtMs`; add regression.
2. (Optional) Invite accept: do not demote `athleteId` role; align with PATCH immutability.
3. Staging deploy + signed-in chat smoke (prior #327 follow-up) if not picking the ping fix next.

## Open risks/blockers

- Open draft correctness PRs #334–#347 still unmerged.
- Auth0 still blocks unattended sim chat E2E.
- Env lacked `node_modules` in this hunt run — ping OOO finding is code-path traced, not executed.

## Successor prompt

```text
Fix out-of-order athlete pings on main@e0d1578: in POST /race-rooms/:roomId/pings, reject when recordedAtMs <= lastAccepted.recordedAtMs (stale/retry). Add raceRoomPings regression. Skip open drafts #334–#348.
```
