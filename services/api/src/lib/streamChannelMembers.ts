/**
 * Keeps Stream Chat channel membership aligned with CrewCue race-room membership.
 * Stream defaults deny ReadChannel to non-members, so the first user to open chat
 * would otherwise be the only Stream member until we add the rest server-side.
 *
 * Implementation notes:
 * - After `channel.create()` the JS SDK may not hydrate `state.members`; we always
 *   `query` with a member page and call `addMembers` with the full crew roster (idempotent).
 * - We only `removeMembers` when the query returned at least one member key, so an empty
 *   local snapshot never strips the whole channel.
 */
import type { FastifyBaseLogger } from "fastify";
import { StreamChat } from "stream-chat";
import { chatChannelIdForRoom, type RaceRoom } from "@crewcue/contracts";
import { deriveStreamUserId, readStreamCredentials } from "./streamChat.js";

function isStreamChannelExistsError(err: unknown): boolean {
  const o = err as {
    message?: string;
    status?: number;
    code?: number;
    response?: { status?: number; data?: { message?: string; code?: number } };
  };
  const msg = String(o?.message ?? o?.response?.data?.message ?? "").toLowerCase();
  if (msg.includes("already exist")) return true;
  if (msg.includes("duplicate")) return true;
  if (msg.includes("can't create") && msg.includes("exist")) return true;
  const st = o?.status ?? o?.response?.status;
  if (st === 409) return true;
  const code = o?.code ?? o?.response?.data?.code;
  if (code === 4) return true;
  return false;
}

/**
 * Upsert Stream users for all crew members, ensure the room's messaging channel exists,
 * and set channel members to exactly the current race-room roster.
 */
export async function syncRaceRoomStreamChannelMembers(
  room: RaceRoom,
  log?: FastifyBaseLogger
): Promise<void> {
  const creds = readStreamCredentials();
  if (!creds) return;

  const streamUsers = room.memberships.map((m) => {
    const id = deriveStreamUserId(m.userId);
    const trimmed = (m.displayName ?? "").trim();
    return trimmed ? { id, name: trimmed } : { id };
  });
  const dedupedUsers = Array.from(new Map(streamUsers.map((u) => [u.id, u])).values());
  const memberStreamIds = dedupedUsers.map((u) => u.id);
  if (memberStreamIds.length === 0) return;

  const desired = new Set(memberStreamIds);

  const client = StreamChat.getInstance(creds.apiKey, creds.apiSecret, {
    timeout: 20_000
  });

  await client.upsertUsers(dedupedUsers);

  const channelId = chatChannelIdForRoom(room.id);
  const channel = client.channel("messaging", channelId, {
    created_by_id: memberStreamIds[0]!,
    members: memberStreamIds
  });

  try {
    await channel.create();
  } catch (err) {
    if (!isStreamChannelExistsError(err)) {
      log?.warn({ err, roomId: room.id }, "Stream channel create failed (will try query + addMembers)");
    }
  }

  await channel.query({
    state: true,
    messages: { limit: 0 },
    members: { limit: 100 }
  });

  await channel.addMembers(memberStreamIds);

  const presentKeys = Object.keys(channel.state.members ?? {});
  if (presentKeys.length > 0) {
    const toRemove = presentKeys.filter((id) => !desired.has(id));
    if (toRemove.length > 0) {
      await channel.removeMembers(toRemove);
    }
  }
}
