import assert from "node:assert/strict";
import test from "node:test";
import type { Channel, MessageResponse } from "stream-chat";
import { CHAT_HISTORY_PAGE_SIZE } from "./chatMessageLimits.js";
import { queryOlderMessagesBefore } from "./chatHistoryPaging.js";

type QueryCall = {
  filter: unknown;
  state: unknown;
};

function fakeChannel(result: { messages?: MessageResponse[] } = {}) {
  const calls: QueryCall[] = [];
  return {
    calls,
    channel: {
      async query(filter: unknown, state: unknown) {
        calls.push({ filter, state });
        return result;
      }
    } as unknown as Channel
  };
}

test("queryOlderMessagesBefore requests the default page before the oldest message", async () => {
  const messages = [{ id: "older-1" }, { id: "older-2" }] as MessageResponse[];
  const fake = fakeChannel({ messages });

  const rows = await queryOlderMessagesBefore(fake.channel, "oldest-visible");

  assert.deepEqual(rows, messages);
  assert.deepEqual(fake.calls, [
    {
      filter: {
        messages: {
          limit: CHAT_HISTORY_PAGE_SIZE,
          id_lt: "oldest-visible"
        }
      },
      state: "current"
    }
  ]);
});

test("queryOlderMessagesBefore honors a custom page size", async () => {
  const fake = fakeChannel({ messages: [] });

  await queryOlderMessagesBefore(fake.channel, "m-10", 7);

  assert.deepEqual(fake.calls, [
    {
      filter: {
        messages: {
          limit: 7,
          id_lt: "m-10"
        }
      },
      state: "current"
    }
  ]);
});

test("queryOlderMessagesBefore treats missing Stream messages as an empty page", async () => {
  const fake = fakeChannel();

  const rows = await queryOlderMessagesBefore(fake.channel, "m-1");

  assert.deepEqual(rows, []);
});
