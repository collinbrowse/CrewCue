import assert from "node:assert/strict";
import test from "node:test";
import type { Channel, MessageResponse } from "stream-chat";
import { queryOlderMessagesBefore } from "./chatHistoryPaging.js";
import { CHAT_HISTORY_PAGE_SIZE } from "./chatMessageLimits.js";

function fakeChannel(messages?: MessageResponse[]): {
  channel: Channel;
  calls: Array<{ filters: unknown; state: unknown }>;
} {
  const calls: Array<{ filters: unknown; state: unknown }> = [];
  return {
    channel: {
      query: async (filters: unknown, state: unknown) => {
        calls.push({ filters, state });
        return { messages };
      }
    } as unknown as Channel,
    calls
  };
}

test("queryOlderMessagesBefore requests messages older than the current oldest id", async () => {
  const older = [{ id: "older-1" }, { id: "older-2" }] as MessageResponse[];
  const { channel, calls } = fakeChannel(older);

  const result = await queryOlderMessagesBefore(channel, "current-oldest");

  assert.deepEqual(result, older);
  assert.deepEqual(calls, [
    {
      filters: { messages: { limit: CHAT_HISTORY_PAGE_SIZE, id_lt: "current-oldest" } },
      state: "current"
    }
  ]);
});

test("queryOlderMessagesBefore supports an explicit page size", async () => {
  const { channel, calls } = fakeChannel([]);

  await queryOlderMessagesBefore(channel, "m-100", 12);

  assert.deepEqual(calls[0], {
    filters: { messages: { limit: 12, id_lt: "m-100" } },
    state: "current"
  });
});

test("queryOlderMessagesBefore treats an omitted Stream messages array as empty", async () => {
  const { channel } = fakeChannel(undefined);

  const result = await queryOlderMessagesBefore(channel, "m-1");

  assert.deepEqual(result, []);
});
