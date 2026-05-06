/**
 * Chat retention worker.
 *
 * Removes chat data 30 days after a race room's `eventEndsAt`. Idempotent and
 * safe to run on a schedule. Returns per-room results so a smoke runbook can
 * confirm coverage.
 *
 * NOTE: this layer only deletes server-side metadata (envelopes, prefs).
 * Stream Chat channel deletion is performed via the Stream SDK on the API
 * tier — out of scope for the in-memory unit tests but documented in the
 * Phase 7 runbook.
 */
import type { RaceRoom } from "@crewcue/contracts";
import type { ChatRetentionResult } from "@crewcue/contracts";
import { deleteChatRoomData } from "./chatPersistence.js";

export const CHAT_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isRoomEligibleForChatDeletion(
  room: Pick<RaceRoom, "eventEndsAt" | "status">,
  now: Date = new Date()
): boolean {
  if (!room.eventEndsAt) return false;
  const endTimeMs = Date.parse(room.eventEndsAt);
  if (!Number.isFinite(endTimeMs)) return false;
  return now.getTime() - endTimeMs >= CHAT_RETENTION_DAYS * MS_PER_DAY;
}

export function computeChatRemovalDate(eventEndsAt: string): Date | undefined {
  const endTimeMs = Date.parse(eventEndsAt);
  if (!Number.isFinite(endTimeMs)) return undefined;
  return new Date(endTimeMs + CHAT_RETENTION_DAYS * MS_PER_DAY);
}

export async function runChatRetentionPass(
  rooms: ReadonlyArray<Pick<RaceRoom, "id" | "eventEndsAt" | "status">>,
  now: Date = new Date()
): Promise<ChatRetentionResult[]> {
  const results: ChatRetentionResult[] = [];
  for (const room of rooms) {
    if (!isRoomEligibleForChatDeletion(room, now)) continue;
    const result = await deleteChatRoomData(room.id);
    results.push(result);
  }
  return results;
}
