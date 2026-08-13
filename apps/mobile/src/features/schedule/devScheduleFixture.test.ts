import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../../api/client";
import {
  applyDevStopPlanUpsert,
  loadDevScheduleFixtureSheet,
  projectDevSheetWithOverlays,
  seedDevStopPlanOverlays
} from "./devScheduleFixture";

test("DEV schedule fixture parses schedule-expected.json with delay stop (EC1/EC5)", () => {
  const sheet = loadDevScheduleFixtureSheet();
  assert.equal(sheet.roomId, "room-fixture-50k");
  assert.ok(sheet.stops.length >= 3);
  const withDelay = sheet.stops.find((s) => s.checkpointId === "aid-2");
  assert.equal(withDelay?.delayOverrideSeconds, 120);
  assert.equal(withDelay?.clockArrivalAt, "2026-08-15T15:20:00.000Z");
  const withoutDelay = sheet.stops.find((s) => s.checkpointId === "aid-1");
  assert.equal(withoutDelay?.delayOverrideSeconds, undefined);
});

test("DEV fixture partial patch leaves unspecified fields (EC1)", () => {
  const existing = {
    delayOverrideSeconds: 120,
    planNotes: { id: "note-plan-aid-2", body: "Drop bag + bottles" }
  };
  const next = applyDevStopPlanUpsert(existing, "aid-2", { delayOverrideSeconds: 300 });
  assert.equal(next?.delayOverrideSeconds, 300);
  assert.equal(next?.planNotes?.id, "note-plan-aid-2");
  assert.equal(next?.planNotes?.body, "Drop bag + bottles");
});

test("DEV fixture rejects negative delay (EC2)", () => {
  assert.throws(
    () => applyDevStopPlanUpsert(undefined, "aid-1", { delayOverrideSeconds: -5 }),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test("DEV fixture empty PUT {} does not clear delay (EC7 contrast)", () => {
  const existing = { delayOverrideSeconds: 120 };
  const next = applyDevStopPlanUpsert(existing, "aid-2", {});
  assert.equal(next?.delayOverrideSeconds, 120);
});

test("DEV fixture clear delay shifts later clocks; waypoint row remains (EC6/EC7)", () => {
  const base = loadDevScheduleFixtureSheet();
  const overlays = seedDevStopPlanOverlays(base);
  const aid2 = overlays.get("aid-2");
  assert.ok(aid2);
  overlays.set("aid-2", applyDevStopPlanUpsert(aid2, "aid-2", { delayOverrideSeconds: null }) ?? {});

  const beforeFinish = base.stops.find((s) => s.checkpointId === "finish")!;
  const projected = projectDevSheetWithOverlays(base, overlays);
  const finish = projected.stops.find((s) => s.checkpointId === "finish")!;
  const aid2Stop = projected.stops.find((s) => s.checkpointId === "aid-2")!;

  assert.equal(aid2Stop.delayOverrideSeconds, undefined);
  assert.equal(aid2Stop.checkpointId, "aid-2");
  assert.equal(finish.elapsedSeconds, beforeFinish.elapsedSeconds - 120);
  assert.equal(finish.clockArrivalAt, "2026-08-15T18:48:00.000Z");
});

test("DEV fixture increasing delay shifts later ISO clocks (EC6)", () => {
  const base = loadDevScheduleFixtureSheet();
  const overlays = seedDevStopPlanOverlays(base);
  overlays.set(
    "aid-1",
    applyDevStopPlanUpsert(overlays.get("aid-1"), "aid-1", { delayOverrideSeconds: 60 })!
  );
  const projected = projectDevSheetWithOverlays(base, overlays);
  const aid1 = projected.stops.find((s) => s.checkpointId === "aid-1")!;
  const aid2 = projected.stops.find((s) => s.checkpointId === "aid-2")!;
  assert.equal(aid1.delayOverrideSeconds, 60);
  // aid-1's own arrival unchanged; aid-2 gains +60s from prior delay.
  assert.equal(aid1.clockArrivalAt, "2026-08-15T14:10:00.000Z");
  assert.equal(aid2.clockArrivalAt, "2026-08-15T15:21:00.000Z");
});

test("DEV fixture duplicate note save keeps stable id (EC5)", () => {
  const first = applyDevStopPlanUpsert(undefined, "aid-1", {
    planNotes: { id: "note-stable", body: "hello" }
  });
  const second = applyDevStopPlanUpsert(first, "aid-1", {
    planNotes: { id: "note-stable", body: "hello" }
  });
  assert.equal(second?.planNotes?.id, "note-stable");
});
