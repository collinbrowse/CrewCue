import test from "node:test";
import assert from "node:assert/strict";
import { getErrorMessage } from "@crewcue/platform-client";
import { ApiError } from "../../api/client";
import { mapScheduleFetchError, mapStopPlanWriteError } from "./scheduleErrors";

test("EC2 maps API 400 no course / no raceStartAt to clear messages", () => {
  assert.equal(
    mapScheduleFetchError(new ApiError(400, { error: "Course required for schedule" })),
    "Add a course before viewing the crew schedule."
  );
  assert.equal(
    mapScheduleFetchError(new ApiError(400, { error: "raceStartAt required for schedule" })),
    "Set a race start time before viewing the crew schedule."
  );
});

test("EC3 maps unauthorized statuses to existing auth error UX", () => {
  assert.equal(mapScheduleFetchError(new ApiError(403, { error: "Forbidden" })), getErrorMessage("forbidden"));
  assert.equal(mapScheduleFetchError(new ApiError(401, { error: "Unauthorized" })), getErrorMessage("unknown"));
});

test("EC4 offline / network uses catalog retry messaging", () => {
  assert.equal(
    mapScheduleFetchError(new Error("Failed to fetch — network offline")),
    getErrorMessage("networkOffline")
  );
});

test("mapStopPlanWriteError maps invalid delay and unauthorized (EC2/EC3)", () => {
  assert.match(
    mapStopPlanWriteError(new ApiError(400, { error: "Invalid stop-plan payload" })),
    /Delay must be zero or a positive/
  );
  assert.equal(mapStopPlanWriteError(new ApiError(403, { error: "Forbidden" })), getErrorMessage("forbidden"));
  assert.match(
    mapStopPlanWriteError(new ApiError(402, { error: "Payment required" })),
    /entitlement/
  );
});

test("mapStopPlanWriteError maps offline without silent success (EC4)", () => {
  assert.equal(
    mapStopPlanWriteError(new Error("Failed to fetch — network offline")),
    getErrorMessage("networkOffline")
  );
});
