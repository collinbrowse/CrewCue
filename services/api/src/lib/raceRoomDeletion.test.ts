/**
 * The full room delete shared by account deletion and the unpaid race sweeper, run against the
 * real store (memory here, Postgres in CI's api-postgres-integration job).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { getRaceRoom } from "../routes/raceRooms.js";
import { appendTrackPoints, listTrackPoints } from "./athletePingTrack.js";
import { insertChatMessage, listChatMessages } from "./chatMessageStore.js";
import { MemoryChatPhotoStore, setChatPhotoStoreForTests } from "./chatPhotoStore.js";
import { listFinishedEfforts, recordFinishedEffort } from "./finishedEffortStore.js";
import { deleteRaceRoomAndData } from "./raceRoomDeletion.js";
import type { RaceRoomExpiryFields } from "./roomPersistence.js";
import { recordRoomRemoval, roomRemovedAt } from "./roomRemovalStore.js";

type App = ReturnType<typeof buildApp>;

const uid = (name: string) => `${name}-${randomUUID().slice(0, 8)}`;

function auth(app: App, sub: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} })}` };
}

async function withApp(run: (app: App) => Promise<void>): Promise<void> {
  const app = buildApp();
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function raceWithData(app: App, runner: string): Promise<RaceRoom> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name: "Deletion 50k", creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201, created.body);
  const room = created.json() as RaceRoom;
  await appendTrackPoints(room.id, [
    { recordedAtMs: Date.now() - 60_000, latitude: 42.0, longitude: -70.0, receivedAtMs: Date.now(), pingId: uid("ping") }
  ]);
  await recordFinishedEffort({
    roomId: room.id,
    athleteUserId: runner,
    finishedAt: new Date().toISOString(),
    courseLengthMeters: 50_000,
    actualFinishSeconds: 20_000,
    stops: []
  });
  // Someone the runner removed (#723): kept outside the room row, with no foreign key.
  await recordRoomRemoval(room.id, `removed-${runner}`, new Date().toISOString());
  return room;
}

test("a condition that says no keeps the room and all its data; it is asked about the stored room", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-kept");
    const room = await raceWithData(app, runner);
    const asked: RaceRoomExpiryFields[] = [];
    const result = await deleteRaceRoomAndData(room.id, (stored) => {
      asked.push(stored);
      return false;
    });
    assert.equal(result, "kept");
    assert.deepEqual(asked, [{ id: room.id, entitlementStatus: "unpaid", createdAt: room.createdAt, creatorId: runner }]);
    assert.ok(await getRaceRoom(room.id));
    assert.equal((await listTrackPoints(room.id, undefined, 100)).length, 1);
    assert.equal((await listFinishedEfforts({ athleteUserId: runner })).length, 1);
    assert.ok(await roomRemovedAt(room.id, `removed-${runner}`), "the removal record stays");
    const read = await app.inject({ method: "GET", url: `/race-rooms/${room.id}`, headers: auth(app, runner) });
    assert.equal(read.statusCode, 200, read.body);
    await deleteRaceRoomAndData(room.id);
  });
});

test("a condition that says yes deletes the room and its data; a repeat finds it gone", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-deleted");
    const room = await raceWithData(app, runner);
    assert.equal(await deleteRaceRoomAndData(room.id, async () => true), "deleted");
    assert.equal(await getRaceRoom(room.id), undefined);
    assert.deepEqual(await listTrackPoints(room.id, undefined, 100), []);
    assert.deepEqual(await listFinishedEfforts({ athleteUserId: runner }), []);
    assert.equal(await roomRemovedAt(room.id, `removed-${runner}`), undefined, "the removal record went with it");
    const read = await app.inject({ method: "GET", url: `/race-rooms/${room.id}`, headers: auth(app, runner) });
    assert.equal(read.statusCode, 404, read.body);
    let asked = false;
    assert.equal(
      await deleteRaceRoomAndData(room.id, () => {
        asked = true;
        return true;
      }),
      "gone"
    );
    assert.equal(asked, false, "nothing to ask about a room that is gone");
    assert.equal(await deleteRaceRoomAndData(room.id), "gone");
  });
});

test("without a condition the delete is unconditional, as account deletion uses it", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-unconditional");
    const room = await raceWithData(app, runner);
    assert.equal(await deleteRaceRoomAndData(room.id), "deleted");
    assert.equal(await getRaceRoom(room.id), undefined);
    assert.deepEqual(await listTrackPoints(room.id, undefined, 100), []);
  });
});

test("a condition that throws deletes nothing and the error reaches the caller", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-throws");
    const room = await raceWithData(app, runner);
    await assert.rejects(
      deleteRaceRoomAndData(room.id, () => {
        throw new Error("grant lookup failed");
      }),
      /grant lookup failed/
    );
    assert.ok(await getRaceRoom(room.id));
    assert.equal((await listTrackPoints(room.id, undefined, 100)).length, 1);
    await deleteRaceRoomAndData(room.id);
  });
});

test("the condition is asked again as the row is deleted; a no then keeps the room", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-asked-twice");
    const room = await raceWithData(app, runner);
    let asked = 0;
    // Yes before anything is deleted, no as the row goes: a purchase landed in between.
    const result = await deleteRaceRoomAndData(room.id, () => {
      asked += 1;
      return asked === 1;
    });
    assert.equal(result, "kept");
    assert.equal(asked, 2);
    assert.ok(await getRaceRoom(room.id));
    assert.equal((await listTrackPoints(room.id, undefined, 100)).length, 1, "the room's own tables are untouched");
    // The removal is what refuses the removed person's join by code: a kept race keeps it.
    assert.ok(await roomRemovedAt(room.id, `removed-${runner}`), "the removal record stays with the kept race");
    const rejoin = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: room.joinCode },
      headers: auth(app, `removed-${runner}`)
    });
    assert.equal(rejoin.statusCode, 404, `the removed person is still refused: ${rejoin.body}`);

    // A yes both times: the race goes, and its removal record with it.
    assert.equal(await deleteRaceRoomAndData(room.id, () => true), "deleted");
    assert.equal(await getRaceRoom(room.id), undefined);
    assert.equal(await roomRemovedAt(room.id, `removed-${runner}`), undefined, "the removal record went with the race");
  });
});

test("a delete that fails partway leaves the room stored, and a repeat finishes it", async () => {
  const photos = new MemoryChatPhotoStore();
  let photoStoreDown = true;
  setChatPhotoStoreForTests({
    kind: "memory",
    put: (key, bytes, contentType) => photos.put(key, bytes, contentType),
    url: (key) => photos.url(key),
    stat: (key) => photos.stat(key),
    delete: async (keys) => {
      if (photoStoreDown) throw new Error("photo store unavailable");
      return photos.delete(keys);
    }
  });
  try {
    await withApp(async (app) => {
      const runner = uid("runner-partway");
      const room = await raceWithData(app, runner);
      const photoKey = `rooms/${room.id}/${randomUUID()}.jpg`;
      await photos.put(photoKey, Buffer.from("jpeg"), "image/jpeg");
      await insertChatMessage({
        roomId: room.id,
        senderUserId: runner,
        clientMessageId: randomUUID(),
        text: "photo",
        photoKey,
        photoContentType: "image/jpeg",
        photoByteSize: 4
      });

      // Account deletion's unconditional delete, with the photo store down.
      await assert.rejects(deleteRaceRoomAndData(room.id), /photo store unavailable/);
      assert.ok(await getRaceRoom(room.id), "the room is still there to retry");
      assert.equal((await listChatMessages({ roomId: room.id, limit: 10 }))[0]?.photoKey, photoKey);
      assert.ok(await photos.stat(photoKey));

      photoStoreDown = false;
      assert.equal(await deleteRaceRoomAndData(room.id), "deleted");
      assert.equal(await getRaceRoom(room.id), undefined);
      assert.deepEqual(await listChatMessages({ roomId: room.id, limit: 10 }), []);
      assert.equal(await photos.stat(photoKey), undefined);
      assert.deepEqual(await listTrackPoints(room.id, undefined, 100), []);
      assert.deepEqual(await listFinishedEfforts({ athleteUserId: runner }), []);
    });
  } finally {
    setChatPhotoStoreForTests(undefined);
  }
});
