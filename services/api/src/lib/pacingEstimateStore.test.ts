import assert from "node:assert/strict";
import test from "node:test";
import { parsePacingEstimate, type PacingEstimate } from "@crewcue/contracts";
import {
  getPacingEstimateById,
  listPacingEstimatesForAthlete,
  recordPacingEstimateRoom,
  resetPacingEstimateStoreForTests,
  saveLegacyPacingEstimateForTests,
  savePacingEstimate
} from "./pacingEstimateStore.js";

function buildEstimate(overrides: Partial<PacingEstimate> = {}): PacingEstimate {
  return parsePacingEstimate({
    id: "est_store_default",
    coldStart: true,
    expectedFinishAt: "2026-08-15T20:00:00.000Z",
    expectedFinishElapsedSeconds: 25_200,
    aidEtas: [
      {
        checkpointId: "aid-1",
        clockArrivalAt: "2026-08-15T15:00:00.000Z",
        elapsedSeconds: 7200
      }
    ],
    explanation: "Store test estimate.",
    ...overrides
  });
}

test("pacing estimate store returns undefined for missing ids and resets rows", async () => {
  await resetPacingEstimateStoreForTests();
  assert.equal(await getPacingEstimateById("est_missing"), undefined);

  const estimate = buildEstimate({ id: "est_reset" });
  await savePacingEstimate("athlete-reset", estimate);
  assert.equal((await getPacingEstimateById("est_reset"))?.athleteUserId, "athlete-reset");

  await resetPacingEstimateStoreForTests();
  assert.equal(await getPacingEstimateById("est_reset"), undefined);
});

test("pacing estimate store replaces same id owner and payload", async () => {
  await resetPacingEstimateStoreForTests();
  const first = buildEstimate({
    id: "est_replace",
    explanation: "Original estimate."
  });
  const replacement = buildEstimate({
    id: "est_replace",
    coldStart: false,
    expectedFinishAt: "2026-08-15T19:30:00.000Z",
    expectedFinishElapsedSeconds: 23_400,
    aidEtas: [
      {
        checkpointId: "aid-2",
        clockArrivalAt: "2026-08-15T16:30:00.000Z",
        elapsedSeconds: 12_600
      }
    ],
    explanation: "Replacement estimate.",
    historyRefIds: ["hist-long-trail"]
  });

  await savePacingEstimate("athlete-original", first);
  await savePacingEstimate("athlete-replacement", replacement);

  assert.deepEqual(await getPacingEstimateById("est_replace"), {
    athleteUserId: "athlete-replacement",
    estimate: replacement,
    roomIds: [],
    legacyProvenance: false
  });
});

test("pacing estimate store: saves add rooms to the set and never remove one", async () => {
  await resetPacingEstimateStoreForTests();
  const estimate = buildEstimate({ id: "est_rooms" });
  const curve = {
    points: [
      { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
      { distanceMetersFromStart: 50_000, referenceElapsedSeconds: 25_200 }
    ]
  };

  const first = await savePacingEstimate("athlete-rooms", estimate, curve, { roomId: "room-b", courseLengthMeters: 50_000 });
  assert.deepEqual(first.roomIds, ["room-b"]);
  // The same id computed for another race, then once without a room: both rooms stay.
  await savePacingEstimate("athlete-rooms", estimate, curve, { roomId: "room-a", courseLengthMeters: 50_000 });
  await savePacingEstimate("athlete-rooms", estimate, curve);
  // Attaching records the room; a room already recorded is not written again.
  const beforeAttach = await getPacingEstimateById("est_rooms");
  assert.ok(beforeAttach);
  await recordPacingEstimateRoom(beforeAttach, "room-c");
  await recordPacingEstimateRoom((await getPacingEstimateById("est_rooms"))!, "room-a");

  assert.deepEqual(await getPacingEstimateById("est_rooms"), {
    athleteUserId: "athlete-rooms",
    estimate,
    baselineTrack: curve,
    roomIds: ["room-a", "room-b", "room-c"],
    legacyProvenance: false,
    courseLengthMeters: 50_000
  });
  assert.deepEqual(
    (await listPacingEstimatesForAthlete("athlete-rooms")).map((row) => row.roomIds),
    [["room-a", "room-b", "room-c"]]
  );
});

test("pacing estimate store: concurrent saves for different rooms both stay recorded", async () => {
  await resetPacingEstimateStoreForTests();
  const estimate = buildEstimate({ id: "est_concurrent" });
  await Promise.all(
    ["room-1", "room-2", "room-3", "room-4"].map((roomId) => savePacingEstimate("athlete-concurrent", estimate, undefined, { roomId }))
  );
  assert.deepEqual((await getPacingEstimateById("est_concurrent"))?.roomIds, ["room-1", "room-2", "room-3", "room-4"]);
});

test("pacing estimate store: legacy rows read as legacy, keep a #724 room, and any save upgrades them", async () => {
  await resetPacingEstimateStoreForTests();
  const beforeTeaser = buildEstimate({ id: "est_legacy_none" });
  const fromTeaser = buildEstimate({ id: "est_legacy_724" });
  await saveLegacyPacingEstimateForTests("athlete-legacy", beforeTeaser);
  await saveLegacyPacingEstimateForTests("athlete-legacy", fromTeaser, { roomId: "room-724" });

  const none = await getPacingEstimateById(beforeTeaser.id);
  assert.deepEqual(none, { athleteUserId: "athlete-legacy", estimate: beforeTeaser, roomIds: [], legacyProvenance: true });
  const one = await getPacingEstimateById(fromTeaser.id);
  assert.deepEqual(one?.roomIds, ["room-724"]);
  assert.equal(one?.legacyProvenance, true);

  // Attaching a legacy row writes it in the current format: the #724 room stays in the set.
  await recordPacingEstimateRoom(one!, "room-724");
  await recordPacingEstimateRoom((await getPacingEstimateById(fromTeaser.id))!, "room-new");
  const upgraded = await getPacingEstimateById(fromTeaser.id);
  assert.deepEqual(upgraded?.roomIds, ["room-724", "room-new"]);
  assert.equal(upgraded?.legacyProvenance, false);
  assert.equal(upgraded?.courseLengthMeters, undefined, "no length is invented for a legacy row");
});

test("pacing estimate store rejects invalid replacement without clobbering existing row", async () => {
  await resetPacingEstimateStoreForTests();
  const existing = buildEstimate({
    id: "est_reject_invalid",
    explanation: "Existing valid estimate."
  });
  await savePacingEstimate("athlete-existing", existing);

  const invalidReplacement = {
    ...existing,
    expectedFinishElapsedSeconds: -1
  } as unknown as PacingEstimate;

  await assert.rejects(
    () => savePacingEstimate("athlete-invalid", invalidReplacement),
    /expectedFinishElapsedSeconds must be a non-negative finite number of seconds/
  );
  assert.deepEqual(await getPacingEstimateById("est_reject_invalid"), {
    athleteUserId: "athlete-existing",
    estimate: existing,
    roomIds: [],
    legacyProvenance: false
  });
});
