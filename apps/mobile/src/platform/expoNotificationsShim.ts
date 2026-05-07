/**
 * Do not import `expo-notifications` from its package root in app code.
 * The root `build/index.js` re-exports `NotificationsEmitter`, which
 * instantiates `LegacyEventEmitter` at load time. If the native module is not
 * linked (missing config plugin / stale dev client), that throws:
 * `Invariant Violation: new NativeEventEmitter() requires a non-null argument`.
 *
 * Import only the permission + device-token modules, which talk to
 * `NotificationPermissionsModule` / `PushTokenManager` without touching the
 * notification event emitter.
 */
export { getPermissionsAsync, requestPermissionsAsync } from "expo-notifications/build/NotificationPermissions";
export { getDevicePushTokenAsync } from "expo-notifications/build/getDevicePushTokenAsync";
