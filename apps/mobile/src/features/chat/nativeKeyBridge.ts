/**
 * Native keychain bridge for the iOS Notification Service Extension and
 * Android FCM service.
 *
 * Strict E2E push decryption requires the per-channel symmetric key to be
 * available on the recipient device when the notification arrives. We push
 * the key into the platform-specific shared store:
 *
 *   - iOS: keychain item under the App Group `group.com.crewcue.mobile.chat`
 *     so the NSE (which runs in its own process) can read it.
 *   - Android: EncryptedSharedPreferences read by `ChatMessagingService`.
 *
 * Until the corresponding Expo native module ships, this module degrades to
 * a no-op so the JS layer keeps working under the managed Expo workflow.
 * In that mode the OS will show the generic fallback body
 * `New Message in Crew Chat` instead of the decrypted preview.
 */
import { Platform } from "react-native";

type ChatNativeBridge = {
  setChannelKey(roomId: string, keyB64: string): Promise<void>;
  removeChannelKey(roomId: string): Promise<void>;
};

let cachedBridge: ChatNativeBridge | undefined;

async function loadNativeBridge(): Promise<ChatNativeBridge | undefined> {
  if (cachedBridge) return cachedBridge;
  if (Platform.OS === "web") return undefined;
  try {
    const { NativeModules } = await import("react-native");
    const candidate = NativeModules.CrewCueChatNativeBridge as ChatNativeBridge | undefined;
    if (candidate && typeof candidate.setChannelKey === "function") {
      cachedBridge = candidate;
      return candidate;
    }
  } catch {
    // module not present in managed expo; fall through to no-op.
  }
  return undefined;
}

export async function shareChannelKeyWithExtension(
  roomId: string,
  keyB64: string
): Promise<void> {
  const bridge = await loadNativeBridge();
  if (!bridge) return;
  try {
    await bridge.setChannelKey(roomId, keyB64);
  } catch {
    // best-effort only — push will fall back to the generic body.
  }
}

export async function removeChannelKeyFromExtension(roomId: string): Promise<void> {
  const bridge = await loadNativeBridge();
  if (!bridge) return;
  try {
    await bridge.removeChannelKey(roomId);
  } catch {
    // best-effort only.
  }
}
