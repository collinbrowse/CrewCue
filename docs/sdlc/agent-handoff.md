# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-10 (UTC)
- **Roadmap phase:** Practical E2E crew chat hardening / critical bug-hunt.
- **Branch:** `cursor/critical-bug-investigation-cec1`
- **Issue:** none created for this cron automation run.
- **PR:** #311 — Fix critical chat crypto poisoning and backup clobbering.
- **Acceptance criteria:** fix only high-confidence critical bugs; keep patches minimal; add regressions; run local parity verification.

## Completed (this session)

- Fixed API chat key-envelope upload poisoning: batches now reject non-member recipients, mixed versions, non-positive versions, and key-version jumps outside initial bootstrap/current version/solo rekey.
- Fixed unreadable identity-backup data loss: a secret-mismatched install no longer replaces the registered chat identity or overwrites an unreadable server backup with a partial local snapshot.
- Added API and chat-crypto regression tests for both concrete failure modes.
- Do-not-change guardrails honored: no mobile UI changes, no contract shape changes, no broad chat/API refactor.

## Validation evidence

- `npm run test -w @crewcue/chat-crypto` — pass (10 tests).
- `npm run typecheck -w @crewcue/chat-crypto` — pass.
- `npm run test:memory -w @crewcue/api` — pass.
- `npm run verify` — pass.

## Next 1-3 tasks

1. Confirm PR CI is green after automation opens the PR.
2. Follow-up hardening: decide whether same-version envelope overwrites should be insert-only or sender-constrained.
3. Design a user-visible recovery flow for fresh installs that cannot decrypt an existing identity backup.

## Open risks/blockers

- No GitHub issue was created because this cron bug-hunt was triggered without an issue and `gh` write operations are unavailable in this environment.
- Fresh/secret-mismatched installs now fail closed instead of clobbering identity/backup state; they may remain in secure-chat syncing until a recovery flow exists.
- No iOS simulator run: API/package crypto behavior changed, not mobile UI.

## Successor prompt

```text
On cursor/critical-bug-investigation-cec1, review the PR fixing chat key-envelope poisoning and unreadable-backup clobbering. Confirm CI green. If continuing hardening, focus narrowly on same-version envelope overwrite semantics or fresh-install identity recovery UX.
```
