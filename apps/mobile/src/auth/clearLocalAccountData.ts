/**
 * Clear device-local account data on sign-out / expired-session teardown.
 *
 * After plaintext chat (#324), transcript caches and outboxes are readable and
 * actionable across Auth0 accounts on a shared device unless we wipe them here.
 *
 * Callers supply storage/stream deps so Node unit tests stay free of RN modules.
 */
export type ClearLocalAccountDataDeps = {
  clearTranscriptCaches: () => Promise<string[]>;
  /**
   * Wipe chat send queues. Receives room ids discovered from transcript caches
   * so pre-index SecureStore outboxes (created before the room index existed)
   * are still deleted on native where keys cannot be listed.
   */
  clearChatOutboxes: (knownRoomIds: string[]) => Promise<string[]>;
  clearNotificationPref: (roomId: string) => Promise<void>;
  clearSyncOutbox: () => Promise<void>;
  disconnectStream: () => Promise<void>;
};

export async function clearLocalAccountData(deps: ClearLocalAccountDataDeps): Promise<void> {
  const transcriptRooms = await deps.clearTranscriptCaches();
  const outboxRooms = await deps.clearChatOutboxes(transcriptRooms);
  const roomIds = Array.from(new Set([...transcriptRooms, ...outboxRooms]));
  for (const roomId of roomIds) {
    await deps.clearNotificationPref(roomId);
  }
  await deps.clearSyncOutbox();
  await deps.disconnectStream();
}
