import test from "node:test";
import assert from "node:assert/strict";
import { makeEntry, type ChatOutbox } from "./messageQueueCore";
import { createChatOutboxController } from "./messageQueueLock";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Photo send has already read the outbox and is about to write "A sent" /
 * "A removed". A follow-up text enqueued in that window must still be stored.
 * Without the lock, the in-flight write replaces the list and `markSending`
 * never sees the follow-up, so it is not sent and does not survive relaunch.
 */
test("chat outbox keeps a message enqueued while another send is writing", async () => {
  const roomId = "room-1";
  const photo = makeEntry(
    { roomId, body: "photo", attachmentUri: "file://photo.jpg" },
    1_000,
    "photo"
  );
  photo.status = "sending";
  photo.attempts = 1;

  let box: ChatOutbox = { roomId, entries: [photo] };
  let reads = 0;
  let writes = 0;
  const enteredFirstWrite = deferred();
  const releaseFirstWrite = deferred();

  const controller = createChatOutboxController({
    async read() {
      reads += 1;
      return structuredClone(box);
    },
    async write(next) {
      writes += 1;
      if (writes === 1) {
        enteredFirstWrite.resolve();
        await releaseFirstWrite.promise;
      }
      box = structuredClone(next);
    }
  });

  const removing = controller.removeEntry("photo");
  await enteredFirstWrite.promise;

  const enqueuing = controller.enqueue(
    { roomId, body: "I'm at aid 3, need ice" },
    2_000
  );
  await Promise.resolve();
  assert.equal(reads, 1, "enqueue must wait until the in-flight write finishes");

  releaseFirstWrite.resolve();
  await removing;
  const followUp = await enqueuing;

  assert.deepEqual(
    box.entries.map((entry) => entry.id),
    [followUp.id]
  );
  assert.equal(box.entries[0]?.body, "I'm at aid 3, need ice");
  assert.equal(reads, 2);
});

test("chat outbox markSending refuses a second send without rewriting the queue", async () => {
  const roomId = "room-1";
  const pending = makeEntry({ roomId, body: "hello" }, 1_000, "msg-1");
  const other = makeEntry({ roomId, body: "keep me" }, 1_100, "msg-2");
  let box: ChatOutbox = { roomId, entries: [pending, other] };
  let writes = 0;
  const controller = createChatOutboxController({
    async read() {
      return structuredClone(box);
    },
    async write(next) {
      writes += 1;
      box = structuredClone(next);
    }
  });

  assert.equal(await controller.markSending("msg-1"), true);
  assert.equal(box.entries[0]?.status, "sending");
  assert.equal(box.entries[0]?.attempts, 1);
  assert.equal(await controller.markSending("msg-1"), false);
  assert.equal(await controller.markSending("missing"), false);
  assert.equal(writes, 1, "refused markSending must not persist a second snapshot");
  assert.equal(box.entries[1]?.body, "keep me");
});

test("chat outbox markSent does not drop a follow-up enqueued during the write", async () => {
  const roomId = "room-1";
  const photo = makeEntry({ roomId, body: "photo" }, 1_000, "photo");
  photo.status = "sending";
  photo.attempts = 1;

  let box: ChatOutbox = { roomId, entries: [photo] };
  let writes = 0;
  const enteredFirstWrite = deferred();
  const releaseFirstWrite = deferred();

  const controller = createChatOutboxController({
    async read() {
      return structuredClone(box);
    },
    async write(next) {
      writes += 1;
      if (writes === 1) {
        enteredFirstWrite.resolve();
        await releaseFirstWrite.promise;
      }
      box = structuredClone(next);
    }
  });

  const marking = controller.markSent("photo", "stream-msg-1");
  await enteredFirstWrite.promise;
  const enqueuing = controller.enqueue({ roomId, body: "follow-up" }, 2_000);
  releaseFirstWrite.resolve();
  await marking;
  const followUp = await enqueuing;

  assert.deepEqual(
    box.entries.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: "photo", status: "sent" },
      { id: followUp.id, status: "pending" }
    ]
  );
  assert.equal(box.entries[0]?.remoteMessageId, "stream-msg-1");
});
