/**
 * Shared Stream + channel-key bootstrap for crew chat.
 */
import type { Channel, MessageResponse, StreamChat } from "stream-chat";
import type { RaceRoom } from "@crewcue/contracts";
import type { ApiClient } from "../../api/client";
import { bootstrapChannelKey, type ChannelMember } from "./chatChannel";
import { registerChatPushToken } from "./pushTokenRegistration";
import { ensureDeviceIdentity } from "./keyStore";
import { rememberStreamUserIdForAuthSub, streamUserIdForAuthSub } from "./streamUserId";
import { CHAT_INITIAL_MESSAGE_COUNT } from "./chatMessageLimits";
import { getOrConnectStreamClient, joinCrewChannel } from "./streamClient";
import type { MentionMember } from "./mentions";

export type RaceChatSessionInput = {
  room: RaceRoom;
  authSub: string;
  api: ApiClient;
  memberships: MentionMember[];
};

export type RaceChatPrefetchInput = RaceChatSessionInput & {
  chatMembershipKey: string;
};

export type RaceChatBootstrapResult = {
  roomId: string;
  streamUserId: string;
  client: StreamChat;
  channel: Channel;
  channelKey: { keyB64: string; keyVersion: number };
  streamIdToDisplayName: Map<string, string>;
  rawInitialMessages: MessageResponse[];
};

export function resolveRosterDisplayName(
  member: MentionMember,
  athleteId: string | undefined,
  creatorName: string | undefined
): string {
  const direct = (member.displayName ?? "").trim();
  if (direct) return direct;
  if (athleteId && member.userId === athleteId) {
    const creator = (creatorName ?? "").trim();
    if (creator) return creator;
  }
  return "Crew member";
}

export async function buildStreamIdDisplayNameMap(
  memberships: MentionMember[],
  athleteId?: string,
  creatorName?: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const m of memberships) {
    const name = resolveRosterDisplayName(m, athleteId, creatorName);
    if (!name) continue;
    const memberUserId = m.userId.trim();
    if (memberUserId) {
      map.set(memberUserId, name);
    }
    try {
      const sid = await streamUserIdForAuthSub(memberUserId);
      map.set(sid, name);
    } catch {
      // ignore lookup failures for individual roster rows
    }
  }
  return map;
}

async function memberIdentities(api: ApiClient, room: RaceRoom): Promise<ChannelMember[]> {
  const out: ChannelMember[] = [];
  for (const m of room.memberships) {
    const identity = await api.getChatUserIdentity(m.userId);
    if (identity?.publicKey) {
      out.push({ userId: m.userId, publicKey: identity.publicKey });
    }
  }
  return out;
}

export async function bootstrapRaceChatSession(args: RaceChatSessionInput): Promise<RaceChatBootstrapResult> {
  const { room, authSub, api, memberships } = args;
  const tokenResp = await api.getChatStreamToken({ roomId: room.id });
  rememberStreamUserIdForAuthSub(authSub, tokenResp.streamUserId);
  const selfMember = memberships.find((m) => m.userId === authSub);
  const selfLabel = selfMember ? resolveRosterDisplayName(selfMember, room.athleteId, room.creatorName) : "";
  const client = await getOrConnectStreamClient(tokenResp, {
    displayName: selfLabel || undefined
  });
  const channel = await joinCrewChannel(client, room.id, {
    messages: { limit: CHAT_INITIAL_MESSAGE_COUNT }
  });

  const members = await memberIdentities(api, room);
  const channelKey = await bootstrapChannelKey(api, room.id, members);

  const streamNames = await buildStreamIdDisplayNameMap(memberships, room.athleteId, room.creatorName);
  streamNames.set(tokenResp.streamUserId, selfLabel || "You");

  try {
    const identity = await ensureDeviceIdentity();
    await registerChatPushToken(api, { deviceId: identity.deviceId });
  } catch {
    // permission denied / no token — chat still works
  }

  const rawInitialMessages = [...channel.state.messages] as unknown as MessageResponse[];

  return {
    roomId: room.id,
    streamUserId: tokenResp.streamUserId,
    client,
    channel,
    channelKey,
    streamIdToDisplayName: streamNames,
    rawInitialMessages
  };
}
