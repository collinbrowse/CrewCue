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

## Session status snapshot

- Last updated: 2026-05-07 (America/Chicago)
- **Active issues:** #236 (Auth0 account-switch prompt), #237 (Stream member sync), #238 (Android dev-build stability); **chat UI polish** tracked in [#240](https://github.com/collinbrowse/CrewCue/issues/240).
- **Active branch:** `feature/chat-screen-ui-polish-240` (PR to `main` pending) — merge when green.
- **Plan:** chat UI plan (bundled header, scroll, scrollbar gutter, reaction overlay, avatars) delivered in this branch; historical E2E reference: [`.cursor/plans/crew_chat_e2e_implementation_2a141adb.plan.md`](../../.cursor/plans/crew_chat_e2e_implementation_2a141adb.plan.md)

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
- Branch cleanup complete: local `feature/crew-chat-e2e` deleted; remote branch already absent.

## Delivered (2026-05-07): mobile chat screen UI polish (#240)

- Native stack header: two-line **race name** (`raceProfile.raceName` → `room.name`), **notifications** in `headerRight`; removed in-screen duplicate header row (`CrewChatScreen`).
- Composer: centered row, fixed-height **Send** shell, Android `textAlignVertical` on composer field.
- List: `scrollToEnd` on initial content + animated after local send; **New messages** chip when unseen indices exist above the viewport; trailing **scrollbar gutter** plus extra trailing inset on **own** rows (`SCROLLBAR_GUTTER` in `CrewChatScreen`).
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

1. Merge PR for `feature/chat-screen-ui-polish-240` (closes #240); manual iOS/Android pass on composer alignment, scrollbar gutter, reaction modal, unseen chip, avatars (`expo prebuild`/dev client if native blur needs refresh).
2. Implement `CrewCueChatNativeBridge` Expo Module (iOS keychain + Android EncryptedSharedPreferences) so `nativeKeyBridge.ts` can sync channel keys to NSE/FCM service paths.
3. Wire production push transport in `chatPushDispatch.ts` (APNS HTTP/2 + FCM HTTP v1) and extend `chatRetentionScheduler.ts` to call `StreamChat.deleteChannel` once `STREAM_API_KEY` / `STREAM_API_SECRET` are configured.

## Validation summary

- Repo root **`npm run verify`** on `feature/chat-screen-ui-polish-240` ✅ (includes mobile `expo export`, dual-client guard, lint, typecheck, tests).
- `npx tsc --noEmit` in `apps/mobile/` ✅ after chat UI edits.

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
Merge the open PR from feature/chat-screen-ui-polish-240 (Closes #240). Rebuild dev clients if expo-blur needs a native sync. Manually sanity-check Crew Chat on iOS+Android (header/title+bell, send scroll-to-end, unseen chip tap, scrollbar gutter vs sent bubbles, blurred reaction modal + dismiss, grouped avatars). Then continue CrewCueChatNativeBridge (chat-push-decryption.md) and push/retention wiring; run npm run verify before each push.
```
