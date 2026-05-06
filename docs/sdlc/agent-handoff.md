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

- Last updated: 2026-05-06 (America/Chicago)
- **Active issues:** Crew Chat E2E rollout (#226 prebuild, #227 backend, #228 mobile module, #229 UI, #232 prefs/push, #233 NSE/FCM scaffolding, #234 retention).
- **Active branch:** `feature/crew-chat-e2e`
- **Plan:** [`.cursor/plans/crew_chat_e2e_implementation_2a141adb.plan.md`](../../.cursor/plans/crew_chat_e2e_implementation_2a141adb.plan.md)

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

## Next 1-3 tasks

1. Open the consolidated PR for `feature/crew-chat-e2e` (closes #226, #227, #228, #229, #232, #233, #234) and watch CI.
2. Implement the `CrewCueChatNativeBridge` Expo Module (iOS keychain + Android EncryptedSharedPreferences) so `nativeKeyBridge.ts` actually pushes channel keys to the NSE / FCM service. Tracked in the Phase 6 follow-up section of `docs/runbooks/chat-push-decryption.md`.
3. Wire production push transport in `chatPushDispatch.ts` (APNS HTTP/2 + FCM HTTP v1) and extend `chatRetentionScheduler.ts` to call `StreamChat.deleteChannel` once `STREAM_API_KEY` / `STREAM_API_SECRET` are configured in the API tier.

## Validation summary

- `npm test` in `apps/mobile/` ✅ (94 passing, includes `crypto.test`, `mentions.test`, `imagePipeline.test`, `messageQueue.test`, `notificationPrefs.test`, `timestamps.test`, `unreadBadge.test`).
- `npm test` in `services/api/` ✅ (94 passing, includes `chatRoutes.test`, `chatRetention.test`, `chatPushDispatch.test`, `chatRetentionScheduler.test`).
- `npx tsc --noEmit` in `apps/mobile/` ✅.
- Native iOS NSE / Android FCM service builds: deferred to runbook (`docs/runbooks/chat-push-decryption.md`) — out of scope for this branch's CI.

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
On feature/crew-chat-e2e, open the consolidated PR closing #226, #227, #228, #229, #232, #233, #234 with the chat plan summary in the body. After CI passes, implement CrewCueChatNativeBridge as an Expo Module (iOS App Group keychain, Android EncryptedSharedPreferences) per docs/runbooks/chat-push-decryption.md Section 5, then wire the production APNS / FCM transports in services/api/src/lib/chatPushDispatch.ts and the StreamChat.deleteChannel call in chatRetentionScheduler.ts. Re-run npm run verify between each step.
```
