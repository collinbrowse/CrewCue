# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-07-16 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream).
- **Branch:** `feature/remove-chat-encryption-mvp`
- **Issue:** #323
- **PR:** #324
- **Acceptance criteria:** Plaintext chat; fix false “Read by everyone”; reduce photo-picker first-tap lag; migration 0014 on Railway preDeploy.

## Completed (this session)

- Kept `streamChat.ts` (token minting still required); fixed stale encrypt comment.
- Fixed false “Read by everyone” (exclude self / require peer read of latest own message).
- Preload image modules + busy indicator on photo button; fixed leftover indentation.
- Closed obsolete crypto draft PRs (#299–#317 set).

## Validation evidence

- Local edits on PR branch; typecheck/mobile pending push.
- Migration 0014 runs via Railway `preDeployCommand` (`npm run db:migrate`), not GitHub Actions against staging.

## Next 1-3 tasks

1. Commit/push follow-ups on #324; merge when smoke OK.
2. Deploy staging API (Railway preDeploy applies 0014) and confirm migrate logs.
3. Signed-in smoke: send message (no false read footer); tap photo (spinner then picker).

## Open risks/blockers

- Auth0 still blocks unattended sim chat E2E.
- Stream-sync / non-crypto draft test PRs left open (#309, #316, #318–#320, etc.).

## Successor prompt

```text
PR #324 follow-ups: push read-receipt + image-preload fixes, merge, deploy staging (Railway runs db:migrate / 0014), smoke chat send + photo attach.
```
