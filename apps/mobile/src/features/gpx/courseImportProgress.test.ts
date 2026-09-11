import assert from "node:assert/strict";
import test from "node:test";
import { COURSE_IMPORT_PROGRESS } from "./courseImportProgress";

test("course import progress stages advance toward calculating splits", () => {
  assert.ok(COURSE_IMPORT_PROGRESS.reading.ratio < COURSE_IMPORT_PROGRESS.parsing.ratio);
  assert.ok(COURSE_IMPORT_PROGRESS.parsing.ratio < COURSE_IMPORT_PROGRESS.calculating.ratio);
  assert.ok(COURSE_IMPORT_PROGRESS.calculating.ratio < 1);
  assert.match(COURSE_IMPORT_PROGRESS.calculating.message, /splits/i);
});
