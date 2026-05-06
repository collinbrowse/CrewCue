/**
 * Thin Stream Chat client wrapper. Connects/disconnects against the user's
 * Stream identity using the API-minted token. We deliberately use the
 * low-level `stream-chat` SDK rather than `stream-chat-react-native` so the
 * UI can lean on the existing CrewCue design system.
 *
 * Server stores ciphertext only — we encrypt on this device before calling
 * `channel.sendMessage` and decrypt incoming events before rendering.
 */
import { StreamChat, type Channel } from "stream-chat";
import { chatChannelIdForRoom, type ChatStreamTokenResponse } from "@crewcue/contracts";

let cachedClient: StreamChat | undefined;
let connectedUserId: string | undefined;

export async function getOrConnectStreamClient(token: ChatStreamTokenResponse): Promise<StreamChat> {
  if (cachedClient && connectedUserId === token.streamUserId) {
    return cachedClient;
  }
  if (cachedClient) {
    await cachedClient.disconnectUser();
    cachedClient = undefined;
    connectedUserId = undefined;
  }
  const client = StreamChat.getInstance(token.streamApiKey);
  await client.connectUser({ id: token.streamUserId }, token.token);
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

export async function joinCrewChannel(client: StreamChat, roomId: string): Promise<Channel> {
  const channel = client.channel("messaging", chatChannelIdForRoom(roomId));
  await channel.watch();
  return channel;
}
