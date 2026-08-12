# Agent handoff source of truth

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `.cursor/rules/github-pr-issue-workflow.mdc`
5. `docs/sdlc/ios-simulator-agent-qa.md` (mobile UI)

## Session status snapshot

- Last updated: 2026-08-12 (UTC)
- **Roadmap phase:** MVP chat reliability (plaintext Stream) - coverage hardening for recent merged chat code.
- **Branch:** `cursor/missing-test-coverage-e09d` from `main` @ `e0d1578`; PR #355 open.
- **Active issue/PR:** PR #355; no issue created because this automation has read-only `gh` guidance and no issue-creation MCP tool.

## Completed

- Added `apps/mobile/src/features/chat/chatHistoryPaging.test.ts`.
- Covered `queryOlderMessagesBefore` cursor/query behavior: default limit, `id_lt` oldest-visible cursor, Stream `"current"` state mode, custom page size, and omitted `messages` empty-page fallback.
- Wired the new test into `@crewcue/mobile`'s existing `npm run test` script.

## Next 1-3 tasks

1. Review/merge this coverage PR after CI passes; link a GitHub issue manually before merge if required.
2. Continue existing staging follow-up for #327: deploy staging API and smoke signed-in chat send/photo/read receipt/load-older behavior.
3. Future coverage candidate: UI-level read receipt/older-history behavior once macOS simulator automation is available.

## Open risks/blockers

- `npm run agent:ios:ready` is blocked in this Linux cloud host: "requires macOS"; simulator acceptance was not exercised.
- Auth0 still blocks unattended signed-in chat E2E without a fixture/deeplink/test account path.
- Stream `messaging` channel type needs Read Events enabled for receipt broadcasts in staging.

## Validation evidence

- `npm run test -w @crewcue/mobile` - passed.
- `npm run typecheck -w @crewcue/mobile` - passed.
- `npm run verify` - passed.
- `npm run agent:ios:ready` - blocked on Linux host requiring macOS.

## Successor prompt

```text
Coverage PR #355 on cursor/missing-test-coverage-e09d adds chatHistoryPaging tests. CI/local verify passed; iOS sim blocked on Linux. Next: review/merge after CI, then continue #327 staging signed-in chat smoke.
```
