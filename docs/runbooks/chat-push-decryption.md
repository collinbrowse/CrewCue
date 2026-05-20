# Crew chat — strict E2E push decryption runbook

This runbook completes Phase 6 of the [Crew Chat E2E Implementation Plan](../sdlc/agent-handoff.md). It covers the one-time native plumbing the operator must perform after `expo prebuild` so that iOS Notification Service Extension (NSE) and Android FirebaseMessagingService can decrypt push previews on-device.

Until this runbook is executed, the OS displays the generic body `New Message in Crew Chat`. Decryption never falls back to the server — the server only ever sees ciphertext.

## 1. Prerequisites

- `apps/mobile/eas.json` configured (Phase 1).
- User identity registered at `POST /chat/identity` and encrypted backup at `POST /chat/identity/backup` (ADR 0006).
- Per-user channel keys wrapped in `chat_channel_envelopes` (not device-scoped).
- Push devices registered via `POST /chat/devices` or `POST /chat/push/tokens` (transport only).
- Apple Developer team that supports App Group entitlements.
- Firebase project with FCM enabled and the `google-services.json` configured for `apps/mobile/android/`.

## 2. Run prebuild

```bash
cd apps/mobile
npx expo prebuild --clean
```

The custom plugin `plugins/withChatPushDecryption.js` will:

1. Add the App Group entitlement `group.com.crewcue.mobile.chat` to the iOS app target.
2. Add `remote-notification` to `UIBackgroundModes`.
3. Copy `plugins/native/ios/NotificationService.swift` into a new `apps/mobile/ios/ChatNotificationServiceExtension/` directory along with `Info.plist` and `.entitlements`.
4. Register `<service android:name=".ChatMessagingService">` in the Android manifest.
5. Copy `plugins/native/android/ChatMessagingService.kt` into `apps/mobile/android/app/src/main/java/com/crewcue/mobile/`.

## 3. Wire iOS NSE target in Xcode

`expo prebuild` cannot create a second Xcode target by itself. Open `apps/mobile/ios/CrewCue.xcworkspace` and:

1. **File → New → Target → Notification Service Extension.** Name it `ChatNotificationServiceExtension` (matches `NSE_TARGET_NAME` in `withChatPushDecryption.js`).
2. Replace the auto-generated Swift file with `apps/mobile/ios/ChatNotificationServiceExtension/NotificationService.swift` (the plugin already copied it).
3. Set the deployment target to match the main app.
4. Open the target's **Signing & Capabilities** tab, add **App Groups**, and check `group.com.crewcue.mobile.chat`. Do the same for the main app target if not already present.
5. Add to the iOS Podfile so the NSE can use libsodium-compatible decryption:
  ```ruby
   target 'ChatNotificationServiceExtension' do
     use_frameworks!
     pod 'Sodium', '~> 0.9'
   end
  ```
6. `cd apps/mobile/ios && pod install`.
7. Build the dev client through EAS Build (`eas build --profile development --platform ios`).

## 4. Wire Android FCM service

After prebuild:

1. Add to `apps/mobile/android/app/build.gradle` under `dependencies`:
  ```groovy
   implementation "com.goterl:lazysodium-android:5.2.0@aar"
   implementation "net.java.dev.jna:jna:5.13.0@aar"
   implementation "androidx.security:security-crypto:1.1.0-alpha06"
  ```
2. Make sure `google-services.json` is in place at `apps/mobile/android/app/`.
3. `eas build --profile development --platform android`.

## 5. Native key bridge (JS → keychain / SharedPreferences)

`apps/mobile/src/features/chat/nativeKeyBridge.ts` calls a native module
`CrewCueChatNativeBridge` that does NOT exist yet. It must be created so the
RN app can hand channel keys to the NSE/FCM service. There are two options:

- **Recommended: Expo Modules API.** Create `apps/mobile/modules/chat-native-bridge/` using `npx create-expo-module --local` and implement two methods:
  - iOS: write/read keychain items in the App Group `group.com.crewcue.mobile.chat` with account `crewcue.chat.channelKey.<roomId>` and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
  - Android: write/read `EncryptedSharedPreferences` named `crewcue.chat.keys` with key `channel.<roomId>`, base64-encoded.
- **Alternative: native-modules-template.** Hand-roll an old-style Native Module exposed as `CrewCueChatNativeBridge` matching the same interface.

Until this module is shipped, `shareChannelKeyWithExtension` is a no-op and pushes will surface as the generic fallback.

## 6. Server-side push transport

`services/api/src/lib/chatPushDispatch.ts` exposes `setChatPushTransport()` so a production deployment can wire APNS HTTP/2 + FCM HTTP v1. The `ChatPushDispatchInput` already carries:

- `channelId`
- `encryptedPreview.ciphertext`
- `encryptedPreview.nonce`
- `encryptedPreview.keyVersion`

Wire those into the APNS/FCM payload exactly as `data` (no alert body) and set `mutable-content: 1` for APNS so the NSE runs.

## 7. End-to-end smoke

Two devices in the same crew with valid push tokens:

1. Device A sends a chat message while Device B's app is backgrounded.
2. Device B should receive a banner with the actual decrypted text.
3. Disable network on Device B before sending — banner appears on reconnect with decrypted body.
4. Wipe and reinstall the app on Device B (loses local channel key) — next push should display `New Message in Crew Chat` until the user opens the app and re-syncs envelopes.

If any of those fail closed (i.e. text leaks server-side), stop and re-audit `chatPushDispatch.ts` — the encrypted preview must be the only place plaintext exists outside the device.

## 8. Rotating the App Group id

If the App Group id ever changes, update **all three** places at once:

- `apps/mobile/plugins/withChatPushDecryption.js` (`APP_GROUP_ID`).
- `apps/mobile/plugins/native/ios/NotificationService.swift` (`appGroupId`).
- The native key bridge module (Section 5).

Otherwise the NSE will silently fall back to the generic body.