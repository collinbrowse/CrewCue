import assert from "node:assert/strict";
import test from "node:test";
import { clearLocalAccountData, type ClearLocalAccountDataDeps } from "./clearLocalAccountData.js";

test("clearLocalAccountData wipes transcript, chat outbox, prefs, sync outbox, and stream", async () => {
  const calls: string[] = [];
  const prefsCleared: string[] = [];
  let outboxKnownRooms: string[] | undefined;
  const deps: ClearLocalAccountDataDeps = {
    clearTranscriptCaches: async () => {
      calls.push("transcript");
      return ["room-a", "room-b"];
    },
    clearChatOutboxes: async (knownRoomIds) => {
      outboxKnownRooms = knownRoomIds;
      calls.push("chatOutbox");
      return ["room-b", "room-c"];
    },
    clearNotificationPref: async (roomId) => {
      prefsCleared.push(roomId);
    },
    clearSyncOutbox: async () => {
      calls.push("syncOutbox");
    },
    disconnectStream: async () => {
      calls.push("stream");
    }
  };

  await clearLocalAccountData(deps);

  assert.deepEqual(calls, ["transcript", "chatOutbox", "syncOutbox", "stream"]);
  assert.deepEqual(outboxKnownRooms, ["room-a", "room-b"]);
  assert.deepEqual(prefsCleared.sort(), ["room-a", "room-b", "room-c"]);
});

test("clearLocalAccountData still clears sync/stream when no rooms were cached", async () => {
  const calls: string[] = [];
  const deps: ClearLocalAccountDataDeps = {
    clearTranscriptCaches: async () => {
      calls.push("transcript");
      return [];
    },
    clearChatOutboxes: async (knownRoomIds) => {
      assert.deepEqual(knownRoomIds, []);
      calls.push("chatOutbox");
      return [];
    },
    clearNotificationPref: async () => {
      calls.push("pref");
    },
    clearSyncOutbox: async () => {
      calls.push("syncOutbox");
    },
    disconnectStream: async () => {
      calls.push("stream");
    }
  };

  await clearLocalAccountData(deps);

  assert.deepEqual(calls, ["transcript", "chatOutbox", "syncOutbox", "stream"]);
});
