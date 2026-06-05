# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-06-05 (UTC)
- **Branch:** `cursor/critical-bug-investigation-ac47`
- **Issue/PR:** none opened; critical-bug sweep only.
- **Roadmap phase:** maintenance / post-merge regression review.

## Completed (this session)

- Reviewed recent main commits for high-severity correctness regressions:
  - `7645107` primary/onPrimary contrast
  - `2accf6c` map peek sheet height
  - `be6aceb` deep-link root alignment
  - `a725699` practical E2E crew chat
- Traced chat key-envelope persistence/bootstrap, member-removal key rotation, push preferences, deep-link deferral, and map sheet sizing paths.
- No concrete critical bug found with a plausible accidental trigger; no product-code fix or PR opened.

## Validation evidence

- `git status --short --branch`, `git log --oneline --decorate -n 20`
- `git show --stat --oneline --decorate -n 8`
- Targeted reads/searches:
  - `services/api/src/routes/chatRoutes.ts`
  - `services/api/src/lib/chatPersistence.ts`
  - `packages/chat-crypto/src/roomKey.ts`
  - `apps/mobile/src/navigation/linking*.ts`
  - `apps/mobile/src/navigation/TrackMapDashboardScreen.tsx`
  - `services/api/src/routes/chatRoutes.test.ts`
- No tests run because no runtime behavior was changed.

## Next 1-3 tasks

1. Continue daily critical-regression sweeps on new merges.
2. If desired, add non-critical hardening tests for chat envelope recipient membership and map sheet peek/expand behavior.
3. Run mobile simulator smoke only when a mobile UI fix is actually made.

## Open risks/blockers

- No critical findings; no PR created per automation safety rule.
- Chat envelope upload trusts member-supplied recipient IDs/key versions; reviewed as a potential malicious-member DoS/hardening item, not a confirmed critical escaped-review bug.
- Map sheet and deep-link changes still have limited end-to-end simulator coverage.

## Successor prompt

```text
Run the daily critical-bug sweep on commits after 7645107. Only fix/open PR for concrete data-loss/crash/security/significant-breakage scenarios; otherwise report no critical bugs found.
```
