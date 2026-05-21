# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-05-20 (UTC)
- **Branch:** `main` (merged)
- **Issue:** [#288](https://github.com/collinbrowse/CrewCue/issues/288) — closed via PR
- **PR:** [#289](https://github.com/collinbrowse/CrewCue/pull/289) — **merged** (squash)
- **Plan:** `docs/sdlc/plans/practical-e2e-crew-chat.md`

## Completed (this session)

- Practical E2E crew chat shipped on `main` (ADR 0006, migration 0013, `@crewcue/chat-crypto`, API identity/backup/user envelopes, mobile key sync).
- **Staging soak:** `./scripts/staging-soak-chat.sh` PASSED on `https://crewcue-staging.up.railway.app`.
- **CI:** PR #289 — `checks`, `dual-client-guard`, `api-postgres-integration`, `pr-decision-doc-guard` all pass.
- **iOS sim:** `crewcue://chat` → TMR 100k; identity path OK; composer/Send visible; legacy messages show decrypt placeholder (expected).

## Validation evidence

- CI `checks` on PR #289 — pass (~5m)
- Staging chat soak — user-confirmed PASS
- `npm run agent:ios:ready` — OK; sim chat screen exercised (see PR #289 comment)
- PR sim notes: https://github.com/collinbrowse/CrewCue/pull/289#issuecomment-4503110891

## Next 1-3 tasks

1. **Staging:** ensure migration **0013** applied in all staging DBs if not already (soak implies yes).
2. **Optional sim hardening:** add `accessibilityLabel="Send"` on chat composer button for XcodeBuildMCP; Maestro flow for send + plaintext assert.
3. **Optional:** second device / fresh install to confirm new outbound encrypt-decrypt roundtrip (not blocked for merge).

## Open risks/blockers

- Legacy room ciphertext may remain undecryptable until another member opens chat and re-wraps at current key version.
- Full AX tree sparse in RN sim — prefer labels on primary actions for agent QA.

## Successor prompt

```text
On main after #289: optional Maestro chat send smoke; verify new message encrypt/decrypt on two simulators or staging devices. Confirm staging migration 0013 everywhere.
```
