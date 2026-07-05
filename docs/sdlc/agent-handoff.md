# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-05 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-a06d`
- **Issue:** none created for this automation run.
- **PR:** pending automation PR for this branch.
- **Acceptance criteria:** fix high-confidence critical bugs; keep patch minimal; add regression tests; run local parity verification.

## Completed (this session)

- Fixed undecryptable chat identity backups so a fresh/secret-mismatched install does not register a new public key, create new envelopes, or overwrite the existing server backup.
- Fixed chat room-key bootstrap to try lower-version envelopes when a higher-version envelope cannot be decrypted, avoiding lockout from poisoned high-version envelopes.
- Added API guards for chat key-envelope uploads: recipients must be current room members, batches must use one positive key version, and uploads cannot jump beyond `latest + 1`.
- Added regression coverage in `packages/chat-crypto/src/roomKey.test.ts` and `services/api/src/routes/chatRoutes.test.ts`.
- Do-not-change guardrails honored: no mobile UI changes, no contract shape changes, no broad chat push/webhook refactor.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto && npm run test:memory -w @crewcue/api` — pass (chat crypto 10/10; API memory 109 pass, 3 skipped).
- `npm run typecheck -w @crewcue/chat-crypto && npm run typecheck -w @crewcue/api` — pass.
- `npm run verify` — pass, including workspace builds and mobile `expo export`.

## Next 1-3 tasks

1. Open the automation PR and monitor CI.
2. Separately assess `/chat/push/webhook` authentication/signature requirements before production push transport is enabled.
3. Consider a future envelope authenticity design if the chat threat model must protect against malicious current room members.

## Open risks/blockers

- No GitHub issue was created for this automation run.
- Existing backup ciphertext remains unrecoverable when the local backup secret is gone; this fix preserves server state instead of replacing it.
- The API cannot cryptographically prove envelope contents match a specific room key; client fallback and server guards reduce lockout risk without changing protocol shape.
- No iOS simulator run: API/shared package behavior changed, not mobile UI.

## Successor prompt

```text
On cursor/critical-bug-investigation-a06d, review the chat backup/envelope poisoning fix PR, confirm CI, then merge if green. Follow-up candidates: webhook auth/signature hardening and longer-term envelope authenticity design.
```
