import type { Channel, MessageResponse } from "stream-chat";
import { CHAT_HISTORY_PAGE_SIZE } from "./chatMessageLimits";

/** Loads messages older than `oldestMessageId` into the channel's current message set. */
export async function queryOlderMessagesBefore(
  channel: Channel,
  oldestMessageId: string,
  pageSize: number = CHAT_HISTORY_PAGE_SIZE
): Promise<MessageResponse[]> {
  const res = await channel.query(
    { messages: { limit: pageSize, id_lt: oldestMessageId } },
    "current"
  );
  return (res.messages ?? []) as MessageResponse[];
}
