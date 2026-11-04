import test from "node:test";
import assert from "node:assert/strict";
import {
  completeArrivalSeconds,
  validateCourseHistoryEvent,
  type CourseHistoryEvent
} from "./format.js";
import { CourseHistoryImportError, parseCourseHistoryJson } from "./sources/fileImport.js";

function sampleEvent(): CourseHistoryEvent {
  return {
    formatVersion: 1,
    source: "file",
    sourceEventId: "sample-2026",
    name: "Sample 50K",
    startTime: "2026-06-01T12:00:00Z",
    checkpoints: [
      { id: "start", name: "Start", distanceMeters: 0, latitude: 39.15, longitude: -120.25 },
      { id: "aid1", name: "Aid 1", distanceMeters: 10_000 },
      { id: "aid2", name: "Aid 2", distanceMeters: 25_000 },
      { id: "finish", name: "Finish", distanceMeters: 50_000 }
    ],
    efforts: [
      {
        splits: [
          { checkpointId: "aid1", inSeconds: 3600, outSeconds: 3700 },
          { checkpointId: "aid2", inSeconds: 9000 },
          { checkpointId: "finish", inSeconds: 20_000 }
        ]
      }
    ]
  };
}

function errorsOf(input: unknown): string[] {
  const result = validateCourseHistoryEvent(input);
  assert.equal(result.ok, false, "expected the event to be rejected");
  return result.ok ? [] : result.errors;
}

test("a well-formed event validates", () => {
  const result = validateCourseHistoryEvent(sampleEvent());
  assert.equal(result.ok, true);
});

test("rejects an in time earlier than the previous checkpoint", () => {
  const event = sampleEvent();
  event.efforts[0]!.splits[1]!.inSeconds = 3000;
  assert.match(errorsOf(event).join("\n"), /before the out time at "aid1"/);
});

test("rejects an out time before its own in time", () => {
  const event = sampleEvent();
  event.efforts[0]!.splits[0]!.outSeconds = 3500;
  assert.match(errorsOf(event).join("\n"), /out time at "aid1" is before its in time/);
});

test("rejects a next arrival before the previous departure", () => {
  const event = sampleEvent();
  event.efforts[0]!.splits[0]!.outSeconds = 9500;
  assert.match(errorsOf(event).join("\n"), /in time at "aid2" is before the out time at "aid1"/);
});

test("rejects splits at unknown checkpoints", () => {
  const event = sampleEvent();
  event.efforts[0]!.splits[1]!.checkpointId = "aid9";
  assert.match(errorsOf(event).join("\n"), /unknown checkpoint "aid9"/);
});

test("rejects splits out of checkpoint order", () => {
  const event = sampleEvent();
  const [a, b, finish] = event.efforts[0]!.splits;
  event.efforts[0]!.splits = [b!, a!, finish!];
  assert.match(errorsOf(event).join("\n"), /out of checkpoint order/);
});

test("rejects an effort missing the finish", () => {
  const event = sampleEvent();
  event.efforts[0]!.splits.pop();
  assert.match(errorsOf(event).join("\n"), /missing the finish split/);
});

test("rejects checkpoints that don't increase in distance or don't start at 0", () => {
  const event = sampleEvent();
  event.checkpoints[2]!.distanceMeters = 5000;
  assert.match(errorsOf(event).join("\n"), /distanceMeters must increase/);
  const shifted = sampleEvent();
  shifted.checkpoints[0]!.distanceMeters = 10;
  assert.match(errorsOf(shifted).join("\n"), /start must be at distanceMeters 0/);
});

test("rejects duplicate checkpoint ids, half a coordinate, and unknown sources", () => {
  const event = sampleEvent();
  event.checkpoints[2]!.id = "aid1";
  assert.match(errorsOf(event).join("\n"), /duplicate id "aid1"/);
  const half = sampleEvent();
  delete half.checkpoints[0]!.longitude;
  assert.match(errorsOf(half).join("\n"), /latitude and longitude must be given together/);
  assert.match(errorsOf({ ...sampleEvent(), source: "opensplittime" }).join("\n"), /source/);
});

test("completeArrivalSeconds measures from the runner's start and skips gaps", () => {
  const event = sampleEvent();
  assert.deepEqual(completeArrivalSeconds(event, event.efforts[0]!), [0, 3600, 9000, 20_000]);
  const waveStart = { splits: [{ checkpointId: "start", inSeconds: 600 }, ...event.efforts[0]!.splits] };
  assert.deepEqual(completeArrivalSeconds(event, waveStart), [0, 3000, 8400, 19_400]);
  const gap = { splits: event.efforts[0]!.splits.filter((s) => s.checkpointId !== "aid2") };
  assert.equal(completeArrivalSeconds(event, gap), null);
});

test("file import accepts one event or an array and reports every bad event", () => {
  assert.equal(parseCourseHistoryJson(JSON.stringify(sampleEvent())).length, 1);
  assert.equal(parseCourseHistoryJson(JSON.stringify([sampleEvent(), sampleEvent()])).length, 2);
  const bad = sampleEvent();
  bad.efforts[0]!.splits.pop();
  assert.throws(
    () => parseCourseHistoryJson(JSON.stringify([sampleEvent(), bad]), "races.json"),
    (error: unknown) =>
      error instanceof CourseHistoryImportError && /races\.json/.test(error.message) && /\[1\]/.test(error.errors[0]!)
  );
  assert.throws(() => parseCourseHistoryJson("{not json"), CourseHistoryImportError);
});
