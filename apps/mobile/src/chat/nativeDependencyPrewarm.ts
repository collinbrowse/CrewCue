/**
 * Loads chat-related native subgraph after the JS runtime is attached so
 * `requireNativeModule` (expo-notifications, expo-secure-store) does not run
 * during the initial bundle evaluation phase — that can throw
 * `[runtime not ready]: Cannot find native module 'ExpoNotificationPermissionsModule'`
 * on Android dev clients.
 *
 * Call `runNativeDependencyPrewarm()` from `App` once config is valid (e.g. after
 * `InteractionManager.runAfterInteractions`) so the first visit to Crew Chat does
 * not pay extra Metro chunk loads for these entry points.
 */
import { Platform } from "react-native";

export function runNativeDependencyPrewarm(): void {
  if (Platform.OS === "web") {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../platform/expoNotificationsShim");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../storage/secureStorage");
  } catch (err) {
    if (__DEV__) {
      console.warn("[CrewCue] nativeDependencyPrewarm: skipped (native not ready or not linked)", err);
    }
  }
}
