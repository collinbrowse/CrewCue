/**
 * Push token registration: fetch the device token from `expo-notifications`
 * and register it with our chat backend so the server-side webhook can fan
 * out APNS/FCM with the encrypted preview blob.
 *
 * Strict E2E means our server delivers ciphertext only; the recipient device
 * (or the iOS NSE / Android FCM service from Phase 6) is responsible for
 * decrypting before showing the lock-screen body.
 */
import type { ChatPushPlatform } from "@crewcue/contracts";
import type { ApiClient } from "../../api/client";

export type PushRegistrationDeps = {
  /** Returns the per-device id; call site usually passes ensureDeviceIdentity().deviceId. */
  deviceId: string;
  /**
   * Test/seam for `expo-notifications.getDevicePushTokenAsync()`. The default
   * implementation is loaded lazily so unit tests can stub it without
   * dragging react-native into the Node runner.
   */
  fetchDevicePushToken?: () => Promise<{ data: string; type: "ios" | "android" } | undefined>;
};

export async function registerChatPushToken(api: ApiClient, deps: PushRegistrationDeps): Promise<void> {
  const fetchToken = deps.fetchDevicePushToken ?? defaultFetchDevicePushToken;
  const token = await fetchToken();
  if (!token || !token.data) return;
  const platform: ChatPushPlatform = token.type === "android" ? "android" : "ios";
  await api.registerChatPushToken({
    deviceId: deps.deviceId,
    platform,
    token: token.data
  });
}

async function defaultFetchDevicePushToken(): Promise<
  { data: string; type: "ios" | "android" } | undefined
> {
  try {
    const { getDevicePushTokenAsync, getPermissionsAsync, requestPermissionsAsync } = await import(
      "../../platform/expoNotificationsShim"
    );
    const status = await getPermissionsAsync();
    const granted = status.status === "granted" ? status : await requestPermissionsAsync();
    if (granted.status !== "granted") return undefined;
    const result = await getDevicePushTokenAsync();
    if (!result?.data) return undefined;
    const type = result.type === "android" ? "android" : "ios";
    return { data: String(result.data), type };
  } catch {
    return undefined;
  }
}
