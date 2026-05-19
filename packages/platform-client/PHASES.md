# Platform client — phase gates

Epic: [#275](https://github.com/collinbrowse/CrewCue/issues/275)

Do not start phase N+1 until phase N is checked and `npm run verify` is recorded in `docs/sdlc/agent-handoff.md`.

## Phase 0 — Tracking

- [x] Epic #275 and sub-issues #276–#279 created
- [x] `docs/platform/actions-and-notices.md` scaffolded
- [x] `errors/en.json` skeleton
- [x] Handoff updated

## Phase 1 — Platform core (PR 1, Closes #276)

- [x] `npm run build -w @crewcue/platform-client`
- [x] `npm test -w @crewcue/platform-client`
- [x] Root `postinstall` / `verify` build platform-client

## Phase 2 — Hosts + map + lint (PR 2, Closes #277)

- [x] Phase 1 tests still green
- [x] Mobile `TransientNoticeHost` mounted; map locate uses `replace` (no routine `Alert.alert` for location failure)
- [x] Web `TransientNoticeHost` mounted
- [x] `scripts/lint-no-routine-alert.mjs` in mobile lint
- [x] Manual: double-tap map locate → one banner (simulator checklist)
- [x] `npm run verify` (after metro import fixes)

## Phase 3–4 — Hooks + shell (PR 3, Closes #278)

- [x] `useAction` / lock on Pace save + GPX finish
- [x] Shell fetches use `ignoreIfBusy`; friendly errors only (`mapApiError`)
- [x] Outbox enqueue merge for manual stops
- [x] `npm run verify`

## Phase 5 — Idempotency (PR 4, Closes #279)

- [x] Migration `0010_http_idempotency.sql` + in-memory middleware on create room, PUT course, manual-stop
- [x] Client `Idempotency-Key` on course PUT (GPX/Pace)
- [x] `httpIdempotency.test.ts` + API memory suite 100/100
- [x] Epic ready for PR

## Production hardening (post-audit)

- [x] Claim-before-mutate idempotency (`0012` state column, 5m processing lease, release on failure)
- [x] `canonicalJsonStringify` shared for client/API body hashes
- [x] Shell `setStatusError` → `NoticeBus` (+ Operate Status rail mirror)
- [x] Web notice swipe velocity parity
- [x] Postgres idempotency test in `httpIdempotency.test.ts` (runs under `test:pg`)
