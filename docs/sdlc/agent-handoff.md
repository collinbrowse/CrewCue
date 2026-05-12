# Agent handoff source of truth

Use this as the minimal continuity file between sessions.

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `docs/sdlc/mvp-ui-development-spec.md`
5. `docs/sdlc/ui-delivery-roadmap-and-spec.md`
6. `.cursor/rules/github-pr-issue-workflow.mdc`
7. `.github/pull_request_template.md`

## Recent (2026-05-12): Canonical course length + route-based projection (**merged** PR [#258](https://github.com/collinbrowse/CrewCue/pull/258) → `main`, merge `a880d44`, **Closes** [#257](https://github.com/collinbrowse/CrewCue/issues/257))

- **On `main`:** `recomputeRaceProjection` requires `routeMetricPoints` (≥ 2); canonical length; checkpoint splits require projected `distanceMetersFromStart` (no chord fallback). `raceRooms` resolves route from workspace; course + map-workspace gates when ≥ 2 checkpoints. Mobile Pace tri-column readouts, race start clock row, `paceDeltaAhead` vs `danger` for vs-plan line, `+- 0min` within 1m of plan; `TrackMapDashboardScreen` canonical length chain; `docs/api/ws2-task2-projection.md` updated.

## Recent (2026-05-12): Race setup — native race start + time zone (**merged** PR [#254](https://github.com/collinbrowse/CrewCue/pull/254) → `main`, merge `5b1a791`, **Closes** [#253](https://github.com/collinbrowse/CrewCue/issues/253))

- **On `main`:** `GpxImportScreen` always shows **Race start** with OS date/time pickers (`@react-native-community/datetimepicker`, `timeZoneName`) and searchable **IANA** list; `luxon` normalizes wire `raceStartAt`; **Finish race setup** PATCHes start when course exists and it changed; **Course settings** drops ISO field (points to Race setup); **Athlete setup** uses same picker; race start UI is **not** client-gated by role (API authz unchanged); **expo-localization** + datetimepicker plugins in `apps/mobile/app.json`.
- **Validation:** `npm run verify` green before merge; **rebuild iOS/Android dev clients** after pulling (native modules).

## Recent (2026-05-12): Unified course metrics + projection alignment (**merged** PR [#249](https://github.com/collinbrowse/CrewCue/pull/249) → `main`, merge `9e0d028`)

- **On `main`:** Contracts/map-core/API course pipeline (geodesic-derived metrics, pace-aware baselines, `PUT .../course` recompute + room distance/gain/loss); clients consume server-derived metrics; aligns with **#248** race start / projection bootstrap work.
- **Pre-merge conflict note:** `main` post-#248 had briefly diverged in `raceRooms.ts`; resolved on branch before merge (`d52ca98`).

## Recent (2026-05-12): Race start anchor, projection bootstrap, map sheet (**merged** PR [#248](https://github.com/collinbrowse/CrewCue/pull/248), **Closes** [#247](https://github.com/collinbrowse/CrewCue/issues/247))

- **API (on `main`):** New rooms default **active**; removed **`POST /race-rooms/:id/activate`**; **`PUT .../course`** requires **`raceStartAt`** when saving a course; permissions key **`canEditRaceSetup`**; bootstrap projection on eligible **GET /projection** / after course save; pings use **`raceStartAt ?? activatedAt`** anchor; **`setRaceRoomStatusForTests`** allowed under **postgres** for integration tests.
- **Clients:** Mobile + web `updateRaceCourse` require **`raceStartAt`**; GPX import + athlete setup collect start time; Pace **Race setup** (`GpxImportScreen`) edits start with native pickers + time zone; projection background poll without `room.status === "active"` gate; quiet **404** clears projection; Pace tab uses **`raceStartAt ?? activatedAt`**; map sheet peek shows **next aid + stats** first, checklist when expanded.
- **Docs:** `docs/api/ws2-task2-projection.md` describes bootstrap + `raceStartAt` (no activate).

## Recent fix (2026-05-11): Pace Edit + timeline rail (**merged** PR [#246](https://github.com/collinbrowse/CrewCue/pull/246), **Closes** [#245](https://github.com/collinbrowse/CrewCue/issues/245))

- **Edit:** `GET /race-rooms/:id` permissions include `canEditCheckpointStops`; Pace uses `(roomDetail.permissions ?? JWT current-room role mirror)` for course + stops; Pace focus refetches room detail when missing/stale room id.
- **Timeline rail:** `PaceTimelineRail` + `paceRailCheckpointRowModel` / `paceRailFinishRowModel` — active leg **purple** trunk; marker **opaque** (`card` fill); approach/dwell/finish fractions; **past legs pin marker bottom** after focus advances or checkpoint completed; **dwell** uses `statusRail` card tint + primary left bar and **“At station”** badge vs **“In progress”** en route.
- **Also on `main` from #246:** `CheckpointPickMapScreen`, course/map/linking, projection timeliness tests/docs, `slugToTitle` / course helpers in `@crewcue/map-core`, `AuthenticatedReadoutsScreen` Pace surface (stale banner, course PUT path, etc.).

## Session status snapshot

- Last updated: 2026-05-12 (America/Chicago)
- **#257 / #258:** Merged to **`main`** via **PR [#258](https://github.com/collinbrowse/CrewCue/pull/258)** (merge `a880d44`). Stale **`feature/canonical-pace-projection-257`** removed locally and on origin.
- **#253 / #254:** Merged to **`main`** via **PR [#254](https://github.com/collinbrowse/CrewCue/pull/254)** (merge `5b1a791`). Delete local/remote **`feature/race-start-native-picker-253`** when convenient.
- **#247 / #248:** Merged to **`main`** via **PR [#248](https://github.com/collinbrowse/CrewCue/pull/248)** (merge `563641f`). Delete local/remote `feature/race-start-projection-bootstrap-247` when convenient.
- **PR #249:** Merged to **`main`** via **PR [#249](https://github.com/collinbrowse/CrewCue/pull/249)** (merge `9e0d028`). Delete local/remote **`feature/race-start-projection-isolated`** when convenient (GitHub may auto-delete the remote branch).
- **Pace tab:** Includes **#246**, **#248**, **#249**, **#253/#254**, and **#257/#258** (projection anchor, map sheet, unified course metrics, native race start, canonical route projection + Pace readouts).
- **Default branch:** **`main`** for new work; `git pull origin main` (at or after `a880d44`).
- **Plan:** Chat E2E roadmap continues in parallel; projection lifecycle doc at `docs/api/ws2-task2-projection.md`.

## Current objective

Replace the Chat tab placeholder with a fully functional, end-to-end encrypted crew chat: realtime messaging via Stream, libsodium-style E2E (tweetnacl on JS, swift-sodium / lazysodium-android on native), mentions, fixed reactions, image attachments, send progress + retry, dual `sentAt`/`arrivedAt` timestamps, swipe-to-reveal, unread tab badge, retention banner, push previews decrypted on-device, and a 30-day retention scheduler.

## Phases delivered (feature/crew-chat-e2e)

1. Phase 1 — Expo prebuild scaffolding, EAS profiles, native plugin skeleton, `EXPO_PUBLIC_STREAM_API_KEY` plumbing.
2. Phase 2 — `services/api` chat routes (`/chat/stream-token`, `/chat/devices`, `/chat/rooms/:roomId/key-envelopes`, `/chat/rooms/:roomId/notification-prefs`, `/chat/push/tokens`, `/chat/push/webhook`, `DELETE /chat/rooms/:roomId/messages`), `chat_*` Postgres tables, retention helpers, contracts in `@crewcue/contracts`.
3. Phase 3 — `apps/mobile/src/features/chat/` module: `crypto.ts` (tweetnacl), `keyStore.ts`, `chatChannel.ts`, `streamClient.ts`, `messageQueue.ts`, `imagePipeline.ts`, `mentions.ts`, `notificationPrefs.ts`, `unreadBadge.ts`, `reactions.ts`, `timestamps.ts`, `retention.ts` plus unit tests under `tsx --test`.
4. Phase 4 — `CrewChatScreen.tsx` replacing `ChatPlaceholderScreen`, `ChatStack` wiring, tab badge subscriber on `CrewMainTabs`, retention banner, swipe-and-hold timestamps.
5. Phase 5 — `ChatNotificationPrefsScreen.tsx`, push-token registration helper, pluggable `chatPushDispatch.ts` transport, push webhook respects per-user prefs.
6. Phase 6 — Strengthened `withChatPushDecryption` config plugin (App Group entitlement, NSE source copy, FCM service registration), aligned NSE Swift / Android Kotlin sources on the actual cipher (XSalsa20-Poly1305), added `nativeKeyBridge.ts` with no-op fallback so JS keeps working in managed Expo, runbook at `docs/runbooks/chat-push-decryption.md`.
7. Phase 7 — `chatRetentionScheduler.ts` runs `runChatRetentionPass` on `setInterval` (default 6 h) wired into `services/api/src/server.ts`. New persistence helper `listPersistedRoomsForRetention` and route helper `listRaceRoomsForRetention`. Smoke runbook at `docs/runbooks/chat-smoke.md` and retention runbook at `docs/runbooks/chat-retention.md`.

## Recent fix (2026-05-07): Android dev build crash on launch (Fabric mount)

- **Symptoms:** Development build opens error screen with `com.facebook.react.uimanager.IllegalViewOperationException` / Fabric mounting stack.
- **Fix:** Resolved build-time/native blockers by cleaning duplicated Android service generation and aligning native dependencies (AsyncStorage, FCM/lazysodium/security-crypto). Tracked in issue #238.
- **Action:** Fresh Android dev-client rebuild/install still required after native changes.

## Merge status (2026-05-07)

- PR [#239](https://github.com/collinbrowse/CrewCue/pull/239) merged to `main`.
- PR [#241](https://github.com/collinbrowse/CrewCue/pull/241) merged to `main` (**Closes #240** — mobile chat UI polish: header, composer, scroll, scrollbar strip, reactions, avatars, `expo-blur`).
- Branch cleanup: local + remote `feature/chat-screen-ui-polish-240` deleted after merge.
- Branch cleanup complete: local `feature/crew-chat-e2e` deleted; remote branch already absent.

## Merge status (2026-05-10)

- PR [#243](https://github.com/collinbrowse/CrewCue/pull/243) merged to `main` (**Closes #242**, **Closes #244** — chat loading, New messages chip, Metro prewarm, prefetch, transcript cache, 10-message initial + scroll pagination, chip flash on prepend fix).
- Delete stale branch `fix/chat-load-and-unseen-chip-242` locally/remotely when convenient.

## Merge status (2026-05-11)

- PR [#246](https://github.com/collinbrowse/CrewCue/pull/246) merged to `main` (**Closes #245** — Pace permissions, animated timeline rail + dwell/at-station UX, `canEditCheckpointStops` on race room permissions, checkpoint map picker, projection/course/linking touchpoints). Delete local/remote `feature/pace-edit-permissions-timeline-245` when convenient.

## Delivered (2026-05-10): chat first-load UX + New messages chip (#242 / PR #243)

- **Loading:** `CrewChatScreen` shows a blocking “Loading messages…” state until the first `query` completes when the transcript is still empty (avoids “No messages yet” during bootstrap).
- **New messages chip:** After initial `scrollToEnd`, all indices in the loaded history are marked viewability-seen so rows above the viewport are not treated as unseen (fixes false chip when scrolled to latest).
- **Room change:** Clearing transcript + loading flags when `room?.id` changes avoids stale rows while switching rooms.

## Delivered (2026-05-10): chat Metro prewarm + prefetch + transcript cache (#244 / PR #243)

- **`index.tsx`:** native-only `require` of `expoNotificationsShim` + `secureStorage` at startup (avoids Android “Bundled …ms” on first Chat open from lazy chat imports).
- **Static imports:** `messageQueue`, `notificationPrefs`, `pushTokenRegistration` no longer dynamic-import native modules; pure helpers split to `messageQueueCore` / `notificationPrefsValidation` for Node tests.
- **Prefetch:** `RaceChatPrefetcher` + `raceChatBootstrap` / `raceChatPrefetch` warm Stream while other tabs focused; chat screen consumes in-flight work with **90s** max reuse age.
- **Cache:** `chatTranscriptCache` (AsyncStorage) hydrates last thread per room before network; debounced save on updates.
- **Paging:** initial Stream watch loads **10** newest messages (`chatMessageLimits.ts`); scrolling near the top loads older pages (40 at a time via `id_lt`); transcript cache keeps the same 10-message tail.

## Delivered (2026-05-07): mobile chat screen UI polish (#240)

- Native stack header: two-line **race name** (`raceProfile.raceName` → `room.name`), **notifications** in `headerRight`; removed in-screen duplicate header row (`CrewChatScreen`).
- Composer: centered row, fixed-height **Send** shell, Android `textAlignVertical` on composer field.
- List: `scrollToEnd` on initial content + debounced scroll after send (multiline); **New messages** chip; **Read by everyone** as `ListFooterComponent`; scrollbar: content gap + optional outside strip (`SCROLLBAR_*` in `CrewChatScreen`).
- Long-press reactions: transparent **Modal** + `expo-blur` pill (iOS) / translucent Android fallback; bubble highlight; corrective scroll toward top edge; clearing on send (`expo-blur` dependency in `apps/mobile`).
- Others’ messages: Stream `user.image` as **28px** avatar on **group tail** rows only (`showAvatarTail`).

## Recent fix (2026-05-06): Stream error 17 — second crew member cannot read channel

- **Symptoms:** `User 'u-…' is not allowed to perform action ReadChannel in scope 'messaging'`; history empty for other members.
- **Cause:** Stream channel membership was only whoever first called `watch()`; Postgres crew roster was not reliably mirrored (SDK `create()` did not guarantee `addMembers` without a follow-up `query` + `addMembers`).
- **Fix:** `syncRaceRoomStreamChannelMembers` always `query`s with `members: { limit: 100 }` then idempotent `addMembers` for the full roster; **`POST /chat/stream-token` accepts `{ "roomId": "<uuid>" }` and runs sync before minting the JWT** so one client round-trip prepares the channel; mobile `getChatStreamToken({ roomId })`; `POST /chat/rooms/:roomId/sync-stream-channel` and race-room hooks remain. Issue #237.
- **Deploy note:** Requires a **new mobile binary/OTA** that sends `roomId` on stream-token; API-only redeploy is insufficient if the app still omits the body.

## Recent fix (2026-05-06): Auth0 stuck on previous user (consent only)

- **Symptoms:** After local sign-out, “Continue with email” opened Auth0 on consent for the old account with no way to enter a new email/password.
- **Cause:** Auth0 SSO cookie in the system / in-app browser session.
- **Mobile change:** All `/authorize` requests in `apps/mobile/src/auth/useAuth.ts` include `prompt=login` so Universal Login shows credentials instead of silent SSO.

## Recent fix (2026-05-06): duplicate chat rows + wrong alignment

- **Symptoms:** own messages on the left, author line showed raw Stream id (`u-…` / UUID), Metro “two children with the same key”, occasional double send.
- **Causes:** `isOwn` and name lookup used Auth0 `sub` while Stream `message.user.id` is the server-derived `streamUserId`; `message.new` plus outbox replace produced two list rows with the same `id`; `markSending` did not no-op when already sending.
- **Mobile changes:** `streamUserId.ts` (SHA256-derived id aligned with API), `messageQueue.markSending` returns `false` if already sending/sent, `CrewChatScreen` uses `myStreamUserId` + `streamIdToDisplayName`, collapses duplicate ids in the list, and skips applying remote `isOwn` on the optimistic path.
- **Validated:** `npx tsc --noEmit` and `npm test` in `apps/mobile` (94 passing).

## Recent fix (2026-05-07): sender display names falling back to raw `u-...` ids

- **Symptoms:** Incoming message author label rendered as raw Stream id (`u-...`) instead of crew member display name.
- **Cause:** Two contributing paths: (1) membership→Stream-id lookup could miss mixed id shapes; (2) Stream users were upserted without `name`, so `message.user.name` was often empty/raw.
- **Changes:** `apps/mobile/src/navigation/CrewChatScreen.tsx` now maps both direct membership ids and derived Stream ids and prefers `message.user.name` fallback when valid; `services/api/src/lib/streamChannelMembers.ts` now upserts Stream users with `{ id, name }` from roster display names.
- **Follow-up cause/fix:** mobile `connectUser` was still called with only `{ id }`, which can overwrite Stream user profiles without `name` and keep cross-device author labels at raw ids. Updated `apps/mobile/src/features/chat/streamClient.ts` to pass `{ id, name }` and wired self display-name into the call from `apps/mobile/src/navigation/CrewChatScreen.tsx`.
- **Validated:** `npx tsc --noEmit` in `apps/mobile`, `npm test -- chatRoutes.test.ts` in `services/api`, and `ReadLints` for edited files.

## Next 1-3 tasks

1. On **`main`** (post-**#254**): `git pull`; **rebuild iOS/Android dev clients** (`datetimepicker`, `expo-localization`); optional Pace smoke (Race setup → date/time/zone → finish).
2. Implement `CrewCueChatNativeBridge` Expo Module (iOS keychain + Android EncryptedSharedPreferences) so `nativeKeyBridge.ts` can sync channel keys to NSE/FCM service paths.
3. Wire production push transport in `chatPushDispatch.ts` (APNS HTTP/2 + FCM HTTP v1) and extend `chatRetentionScheduler.ts` to call `StreamChat.deleteChannel` once `STREAM_API_KEY` / `STREAM_API_SECRET` are configured.

## Validation summary

- **#254** merged to `main` (`5b1a791`); run **`npm run verify`** after `git pull` for CI parity.

## Open risks/blockers/questions

- Real APNS / FCM transports are not yet wired; staging push uses the logging transport. The encrypted preview is already piped through, so flipping in real credentials is a localized change.
- The `CrewCueChatNativeBridge` Expo Module does not exist yet; until it's shipped, push previews fall back to `New Message in Crew Chat`. The chat itself works fully and the cipher / payload layout is pinned so the module can be added without breaking changes.
- App-reinstall recovery flow: a device that loses its keypair must be re-enveloped from another device. Documented in the plan's Risks section; UX work tracked in a follow-up issue.

## Guardrails

- Keep HTTP centralized per dual-client guard (`apps/mobile/src/api/client.ts`, `apps/web/src/api/client.ts`). All chat endpoints go through `api.*` helpers.
- Server never sees plaintext. Cipher: tweetnacl `secretbox` (XSalsa20-Poly1305). Any future cipher change requires updating JS, iOS NSE, Android FCM in lock-step.
- Native key sync is best-effort via `nativeKeyBridge` — failures must never throw on the JS path.
- Retention is destructive by design; client/server banner copy must remain in sync (`apps/mobile/src/features/chat/retention.ts` ↔ `services/api/src/lib/chatRetention.ts`).

## Successor prompt

```text
On main (post-#254): git pull; rebuild mobile dev clients; npm run verify. Chat follow-ups: CrewCueChatNativeBridge + production push/retention (#236–#238).
```
