import assert from "node:assert/strict";
import test from "node:test";
import type { Channel } from "stream-chat";
import { CHAT_HISTORY_PAGE_SIZE } from "./chatMessageLimits.js";
import { queryOlderMessagesBefore } from "./chatHistoryPaging.js";

type QueryCall = {
  filters: unknown;
  state: unknown;
};

function fakeChannelReturning(messages?: unknown[]) {
  const calls: QueryCall[] = [];
  const channel = {
    async query(filters: unknown, state: unknown) {
      calls.push({ filters, state });
      return messages === undefined ? {} : { messages };
    }
  } as unknown as Channel;

  return { channel, calls };
}

test("queryOlderMessagesBefore uses the oldest visible message as the id_lt cursor", async () => {
  const messages = [{ id: "older-1" }, { id: "older-2" }];
  const { channel, calls } = fakeChannelReturning(messages);

  const result = await queryOlderMessagesBefore(channel, "current-oldest");

  assert.deepEqual(result, messages);
  assert.deepEqual(calls, [
    {
      filters: { messages: { limit: CHAT_HISTORY_PAGE_SIZE, id_lt: "current-oldest" } },
      state: "current"
    }
  ]);
});

test("queryOlderMessagesBefore honors a custom page size", async () => {
  const { channel, calls } = fakeChannelReturning([]);

  await queryOlderMessagesBefore(channel, "message-42", 7);

  assert.deepEqual(calls[0], {
    filters: { messages: { limit: 7, id_lt: "message-42" } },
    state: "current"
  });
});

test("queryOlderMessagesBefore treats omitted Stream messages as an empty page", async () => {
  const { channel } = fakeChannelReturning();

  const result = await queryOlderMessagesBefore(channel, "oldest");

  assert.deepEqual(result, []);
});
