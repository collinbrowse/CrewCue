/**
 * W2-2 (#386) unit tests: material ETA shift detection, copy, prefs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoom } from "@crewcue/contracts";
import {
  CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS,
  formatCheckInEtaNotifyPreview,
  formatEtaShiftMagnitude,
  isPrefEligibleForCheckInEtaNotify,
  measureMaterialCheckInEtaShift
} from "./checkInEtaNotify.js";

function roomWithAids(overrides?: Partial<RaceRoom>): RaceRoom {
  return {
    id: "room-eta-notify",
    teamId: "team-1",
    athleteId: "athlete-1",
    name: "ETA notify room",
    status: "active",
    createdAt: "2026-08-15T12:00:00.000Z",
    memberships: [
      { userId: "athlete-1", role: "athlete", joinedAt: "2026-08-15T12:00:00.000Z" },
      { userId: "crew-1", role: "crew_member", joinedAt: "2026-08-15T12:00:00.000Z" }
    ],
    entitlement: { status: "paid" },
    raceStartAt: "2026-08-15T13:00:00.000Z",
    plannedPaceSecondsPerKm: 360,
    course: {
      checkpoints: [
        { id: "start", title: "Start", latitude: 39.15, longitude: -120.25, distanceMetersFromStart: 0 },
        {
          id: "aid-1",
          title: "Aid 1",
          latitude: 39.24,
          longitude: -120.25,
          distanceMetersFromStart: 10_000,
          plannedStopSeconds: 600
        },
        {
          id: "finish",
          title: "Finish",
          latitude: 39.55,
          longitude: -120.25,
          distanceMetersFromStart: 50_000
        }
      ]
    },
    ...overrides
  } as RaceRoom;
}

test("measureMaterialCheckInEtaShift: below threshold → null (EC1)", () => {
  const room = roomWithAids();
  const shift = measureMaterialCheckInEtaShift({
    room,
    checkpointId: "aid-1",
    beforeClosedActualByCheckpointId: new Map(),
    afterClosedActualByCheckpointId: new Map([["aid-1", 600 + 30]])
  });
  assert.equal(shift, null);
});

test("measureMaterialCheckInEtaShift: ≥ threshold mid-course → late with label (EC8)", () => {
  const room = roomWithAids();
  const shift = measureMaterialCheckInEtaShift({
    room,
    checkpointId: "aid-1",
    beforeClosedActualByCheckpointId: new Map(),
    afterClosedActualByCheckpointId: new Map([["aid-1", 600 + 120]])
  });
  assert.ok(shift);
  assert.equal(shift.checkpointId, "aid-1");
  assert.equal(shift.checkpointLabel, "Aid 1");
  assert.equal(shift.signedShiftSeconds, 120);
  assert.equal(shift.maxAbsShiftSeconds, 120);
  assert.equal(shift.direction, "late");
  assert.ok(shift.maxAbsShiftSeconds >= CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS);
});

test("measureMaterialCheckInEtaShift: early direction when shorter than plan", () => {
  const room = roomWithAids();
  const shift = measureMaterialCheckInEtaShift({
    room,
    checkpointId: "aid-1",
    beforeClosedActualByCheckpointId: new Map(),
    afterClosedActualByCheckpointId: new Map([["aid-1", 600 - 90]])
  });
  assert.ok(shift);
  assert.equal(shift.direction, "early");
  assert.equal(shift.signedShiftSeconds, -90);
});

test("measureMaterialCheckInEtaShift: finish has no later stops → null", () => {
  const room = roomWithAids();
  const shift = measureMaterialCheckInEtaShift({
    room,
    checkpointId: "finish",
    beforeClosedActualByCheckpointId: new Map(),
    afterClosedActualByCheckpointId: new Map([["finish", 900]])
  });
  assert.equal(shift, null);
});

test("measureMaterialCheckInEtaShift: LWW overwrite delta vs prior actual (no-op → null)", () => {
  const room = roomWithAids();
  const prior = new Map([["aid-1", 720]]);
  const same = measureMaterialCheckInEtaShift({
    room,
    checkpointId: "aid-1",
    beforeClosedActualByCheckpointId: prior,
    afterClosedActualByCheckpointId: new Map([["aid-1", 720]])
  });
  assert.equal(same, null);

  const rewrite = measureMaterialCheckInEtaShift({
    room,
    checkpointId: "aid-1",
    beforeClosedActualByCheckpointId: prior,
    afterClosedActualByCheckpointId: new Map([["aid-1", 720 + 60]])
  });
  assert.ok(rewrite);
  assert.equal(rewrite.signedShiftSeconds, 60);
});

test("formatEtaShiftMagnitude / preview: minutes vs seconds (EC6)", () => {
  assert.equal(formatEtaShiftMagnitude(45), "45 sec");
  assert.equal(formatEtaShiftMagnitude(60), "1 min");
  assert.equal(formatEtaShiftMagnitude(120), "2 min");
  const preview = formatCheckInEtaNotifyPreview({
    checkpointId: "aid-1",
    checkpointLabel: "Aid 1",
    signedShiftSeconds: 120,
    maxAbsShiftSeconds: 120,
    direction: "late"
  });
  assert.equal(preview, "Aid 1 check-in: later stops ~2 min late");
  assert.equal(preview.includes("secret"), false);
});

test("prefs: only all is eligible; mentions and none skipped (EC7)", () => {
  assert.equal(isPrefEligibleForCheckInEtaNotify("all"), true);
  assert.equal(isPrefEligibleForCheckInEtaNotify("mentions"), false);
  assert.equal(isPrefEligibleForCheckInEtaNotify("none"), false);
});
