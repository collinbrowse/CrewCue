/**
 * RN/default wiring for {@link clearLocalAccountData}. Kept separate so Node
 * unit tests can exercise the orchestrator without AsyncStorage / Stream.
 */
import { clearAllTranscriptCaches } from "../features/chat/chatTranscriptCache";
import { clearAllChatOutboxes } from "../features/chat/messageQueue";
import { clearCachedPref } from "../features/chat/notificationPrefs";
import { disconnectStreamClient } from "../features/chat/streamClient";
import * as syncOutboxStore from "../sync/outboxStore";
import { clearLocalAccountData } from "./clearLocalAccountData";

export async function clearLocalAccountDataDefault(): Promise<void> {
  await clearLocalAccountData({
    clearTranscriptCaches: clearAllTranscriptCaches,
    clearChatOutboxes: clearAllChatOutboxes,
    clearNotificationPref: clearCachedPref,
    clearSyncOutbox: () => syncOutboxStore.clearAll(),
    disconnectStream: disconnectStreamClient
  });
}
