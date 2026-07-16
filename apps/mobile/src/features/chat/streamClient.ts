/**
 * Thin Stream Chat client wrapper. Connects/disconnects against the user's
 * Stream identity using the API-minted token. We deliberately use the
 * low-level `stream-chat` SDK rather than `stream-chat-react-native` so the
 * UI can lean on the existing CrewCue design system.
 *
 * Crew chat MVP sends and renders plaintext Stream messages.
 */
import { StreamChat, type Channel, type ChannelQueryOptions } from "stream-chat";
import { chatChannelIdForRoom, type ChatStreamTokenResponse } from "@crewcue/contracts";
import { CHAT_INITIAL_MESSAGE_COUNT } from "./chatMessageLimits";

let cachedClient: StreamChat | undefined;
let connectedUserId: string | undefined;

export async function getOrConnectStreamClient(
  token: ChatStreamTokenResponse,
  opts?: { displayName?: string }
): Promise<StreamChat> {
  if (cachedClient && connectedUserId === token.streamUserId) {
    return cachedClient;
  }
  if (cachedClient) {
    await cachedClient.disconnectUser();
    cachedClient = undefined;
    connectedUserId = undefined;
  }
  const client = StreamChat.getInstance(token.streamApiKey);
  const name = opts?.displayName?.trim();
  await client.connectUser(
    {
      id: token.streamUserId,
      ...(name ? { name } : {})
    },
    token.token
  );
  cachedClient = client;
  connectedUserId = token.streamUserId;
  return client;
}

export async function disconnectStreamClient(): Promise<void> {
  if (!cachedClient) return;
  await cachedClient.disconnectUser();
  cachedClient = undefined;
  connectedUserId = undefined;
}

export async function joinCrewChannel(
  client: StreamChat,
  roomId: string,
  watchOptions?: ChannelQueryOptions
): Promise<Channel> {
  const channel = client.channel("messaging", chatChannelIdForRoom(roomId));
  await channel.watch(
    watchOptions ?? {
      messages: { limit: CHAT_INITIAL_MESSAGE_COUNT }
    }
  );
  return channel;
}
