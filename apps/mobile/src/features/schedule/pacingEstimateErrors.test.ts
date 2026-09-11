import test from "node:test";
import assert from "node:assert/strict";
import { getErrorMessage } from "@crewcue/platform-client";
import { ApiError } from "../../api/client";
import { mapPacingEstimateError } from "./pacingEstimateErrors";

test("EC2: estimate API 400 maps to setup-oriented copy", () => {
  assert.equal(
    mapPacingEstimateError(new ApiError(400, { error: "course_incomplete: distances missing" })),
    "Course checkpoints need distances before a pacing estimate can be built."
  );
  assert.equal(
    mapPacingEstimateError(new ApiError(400, { error: "course_missing" })),
    "Add a course before requesting a pacing estimate."
  );
  assert.equal(
    mapPacingEstimateError(new ApiError(400, { error: "raceStartAt required" })),
    "Set a race start time before requesting a pacing estimate."
  );
});

test("EC3: unauthorized estimate maps to auth catalog copy", () => {
  assert.equal(
    mapPacingEstimateError(new ApiError(403, { error: "Forbidden" })),
    getErrorMessage("forbidden")
  );
  assert.equal(
    mapPacingEstimateError(new ApiError(401, { error: "Unauthorized" })),
    getErrorMessage("unknown")
  );
});

test("EC4: offline estimate maps to offline catalog; no silent success", () => {
  assert.equal(
    mapPacingEstimateError(new Error("Failed to fetch — network offline")),
    getErrorMessage("networkOffline")
  );
});
