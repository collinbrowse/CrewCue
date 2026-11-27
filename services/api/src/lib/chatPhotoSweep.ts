/**
 * Unattached chat photo sweep (ADR 0011).
 *
 * A photo is uploaded first and attached to a message in a second call. One no message holds
 * 24 hours after its upload is deleted from the photo store, then its upload row. Runs with the
 * chat retention pass (chatRetentionScheduler.ts). Idempotent: a photo the store fails to delete
 * keeps its row and is tried again next pass.
 */
import { chatPhotoStore } from "./chatPhotoStore.js";
import { forgetChatPhotoUpload, listUnattachedChatPhotoUploads } from "./chatMessageStore.js";

export const UNATTACHED_CHAT_PHOTO_GRACE_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 500;

export type UnattachedChatPhotoSweepResult = { scanned: number; deleted: number };

export async function sweepUnattachedChatPhotos(now: Date = new Date()): Promise<UnattachedChatPhotoSweepResult> {
  const store = chatPhotoStore();
  if (!store) return { scanned: 0, deleted: 0 };
  const keys = await listUnattachedChatPhotoUploads(new Date(now.getTime() - UNATTACHED_CHAT_PHOTO_GRACE_MS), SWEEP_BATCH);
  let deleted = 0;
  for (const key of keys) {
    // The memory store counts only keys it held; the bucket counts a 404 as deleted. Either way a
    // key the store no longer holds is gone, so drop its row unless the delete itself failed.
    const removed = await store.delete([key]);
    const gone = removed === 1 || (await store.stat(key)) === undefined;
    if (!gone) continue;
    await forgetChatPhotoUpload(key);
    if (removed === 1) deleted += 1;
  }
  return { scanned: keys.length, deleted };
}
