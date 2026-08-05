import assert from "node:assert/strict";
import test from "node:test";
import { createChatOutboxStore, type ChatOutboxKv } from "./messageQueueStore";

function memoryKv(options?: { readDelayMs?: number; writeDelayMs?: number }): ChatOutboxKv {
  const map = new Map<string, string>();
  const readDelayMs = options?.readDelayMs ?? 0;
  const writeDelayMs = options?.writeDelayMs ?? 0;
  const delay = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

  return {
    async getItemAsync(key) {
      await delay(readDelayMs);
      return map.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      await delay(writeDelayMs);
      map.set(key, value);
    },
    async deleteItemAsync(key) {
      await delay(writeDelayMs);
      map.delete(key);
    }
  };
}

test("chat outbox: concurrent markSent+enqueue preserves the new message", async () => {
  const store = createChatOutboxStore(memoryKv({ readDelayMs: 5, writeDelayMs: 15 }));
  const roomId = "room-race";
  const first = await store.enqueueChatMessage({ roomId, body: "first" }, 1_000);

  await Promise.all([
    store.markSent(roomId, first.id, "remote-first").then(() => store.removeEntry(roomId, first.id)),
    store.enqueueChatMessage({ roomId, body: "second" }, 2_000)
  ]);

  const box = await store.loadOutbox(roomId);
  assert.equal(
    box.entries.some((e) => e.body === "second"),
    true,
    "second message must survive concurrent markSent/removeEntry"
  );
  assert.equal(
    box.entries.some((e) => e.id === first.id),
    false,
    "completed first message should be removed"
  );
  assert.equal(box.entries.length, 1);
});

test("chat outbox: concurrent enqueue during markSending keeps both pending sends", async () => {
  const store = createChatOutboxStore(memoryKv({ readDelayMs: 5, writeDelayMs: 15 }));
  const roomId = "room-send";
  const first = await store.enqueueChatMessage({ roomId, body: "a" }, 1_000);

  const [, second] = await Promise.all([
    store.markSending(roomId, first.id),
    store.enqueueChatMessage({ roomId, body: "b" }, 2_000)
  ]);

  const box = await store.loadOutbox(roomId);
  assert.equal(box.entries.length, 2);
  const a = box.entries.find((e) => e.id === first.id);
  const b = box.entries.find((e) => e.id === second.id);
  assert.equal(a?.status, "sending");
  assert.equal(b?.status, "pending");
  assert.equal(b?.body, "b");
});

test("chat outbox: markSending still rejects duplicate claim", async () => {
  const store = createChatOutboxStore(memoryKv());
  const roomId = "room-claim";
  const entry = await store.enqueueChatMessage({ roomId, body: "once" }, 1_000);
  assert.equal(await store.markSending(roomId, entry.id), true);
  assert.equal(await store.markSending(roomId, entry.id), false);
  const box = await store.loadOutbox(roomId);
  assert.equal(box.entries[0]?.attempts, 1);
  assert.equal(box.entries[0]?.status, "sending");
});
