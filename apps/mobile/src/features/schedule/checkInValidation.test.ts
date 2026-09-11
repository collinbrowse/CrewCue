import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, assertValidManualCheckpointStopInput } from "../../api/client";
import { canEditCheckpointStopsFromRoomRole } from "../../auth/roleGuards";
import { closedCheckInActualStopSeconds, validateClosedCheckIn } from "./checkInValidation";

test("EC1 missing arrival or departure fails client validation", () => {
  assert.equal(validateClosedCheckIn({ arrivalAt: "", departureAt: "2026-08-15T14:10:00.000Z" }).ok, false);
  assert.equal(validateClosedCheckIn({ arrivalAt: "2026-08-15T14:00:00.000Z", departureAt: "" }).ok, false);
  assert.throws(
    () =>
      assertValidManualCheckpointStopInput({
        arrivalAt: "2026-08-15T14:00:00.000Z",
        departureAt: ""
      }),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test("EC2 departure ≤ arrival fails validation", () => {
  const equal = validateClosedCheckIn({
    arrivalAt: "2026-08-15T14:00:00.000Z",
    departureAt: "2026-08-15T14:00:00.000Z"
  });
  assert.equal(equal.ok, false);
  if (!equal.ok) {
    assert.match(equal.message, /after arrival/i);
  }

  const before = validateClosedCheckIn({
    arrivalAt: "2026-08-15T14:10:00.000Z",
    departureAt: "2026-08-15T14:00:00.000Z"
  });
  assert.equal(before.ok, false);
});

test("EC3 unauthorized role cannot edit check-in (athlete)", () => {
  assert.equal(canEditCheckpointStopsFromRoomRole("athlete"), false);
  assert.equal(canEditCheckpointStopsFromRoomRole("crew_member"), true);
  assert.equal(canEditCheckpointStopsFromRoomRole("crew_chief"), true);
});

test("EC6 valid closed check-in normalizes ISO and computes actual seconds", () => {
  const ok = validateClosedCheckIn({
    arrivalAt: "2026-08-15T14:00:00.000Z",
    departureAt: "2026-08-15T14:08:00.000Z"
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.input.arrivalAt, "2026-08-15T14:00:00.000Z");
    assert.equal(ok.input.departureAt, "2026-08-15T14:08:00.000Z");
    assert.equal(closedCheckInActualStopSeconds(ok.input), 480);
  }
});
