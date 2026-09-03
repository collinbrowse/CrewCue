import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImportStateFromCourse,
  selectVisibleCourseImportState,
  shouldPreserveLocalImportStateOnHydrate,
  type CourseImportState
} from "./courseImportState";

const savedCourseState: Extract<CourseImportState, { status: "success" }> = {
  status: "success",
  fileName: "saved-course.gpx",
  totalDistanceLabel: "10.00 mi",
  elevationLabel: "1,200 ft gain"
};

const localCourse = {
  fileName: "new-local-course.gpx",
  totalDistanceMeters: 3218.688,
  elevationGainMeters: 123.4
};

test("room hydrate does not clobber a locally selected course waiting to be saved", () => {
  const localSuccess: CourseImportState = {
    status: "success",
    fileName: localCourse.fileName,
    totalDistanceLabel: "2.00 mi",
    elevationLabel: "405 ft gain"
  };

  assert.equal(shouldPreserveLocalImportStateOnHydrate(localSuccess, localCourse), true);
});

test("room hydrate preserves transient and error import states", () => {
  const states: CourseImportState[] = [
    { status: "picking" },
    { status: "calculating", fileName: "route.gpx", ratio: 0.6, message: "Calculating splits..." },
    { status: "error", message: "Choose a valid GPX export." }
  ];

  for (const state of states) {
    assert.equal(shouldPreserveLocalImportStateOnHydrate(state, undefined), true, state.status);
  }
});

test("room hydrate can refresh saved-course display when no local upload is pending", () => {
  assert.equal(shouldPreserveLocalImportStateOnHydrate({ status: "idle" }, undefined), false);
  assert.equal(shouldPreserveLocalImportStateOnHydrate(savedCourseState, undefined), false);
});

test("visible import state prefers pending local course over saved room course", () => {
  const visible = selectVisibleCourseImportState({
    pendingCourseUpload: localCourse,
    importState: savedCourseState,
    persistedCourseState: savedCourseState,
    unit: "mi"
  });

  assert.deepEqual(visible, {
    status: "success",
    fileName: "new-local-course.gpx",
    totalDistanceLabel: "2.00 mi",
    elevationLabel: "405 ft gain"
  });
});

test("visible import state falls back from non-success import state to persisted room course", () => {
  const visible = selectVisibleCourseImportState({
    importState: { status: "idle" },
    persistedCourseState: savedCourseState,
    unit: "mi"
  });

  assert.equal(visible, savedCourseState);
});

test("saved room course state uses stored metrics before baseline fallbacks", () => {
  const state = buildImportStateFromCourse({
    fileName: "persisted.gpx",
    course: {
      checkpoints: [],
      baselineTrack: {
        points: [
          { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
          { distanceMetersFromStart: 100_000, referenceElapsedSeconds: 10_000 }
        ]
      }
    },
    storedDistanceMeters: 1609.344,
    storedElevationGainMeters: 10,
    unit: "mi"
  });

  assert.deepEqual(state, {
    status: "success",
    fileName: "persisted.gpx",
    totalDistanceLabel: "1.00 mi",
    elevationLabel: "33 ft gain"
  });
});
