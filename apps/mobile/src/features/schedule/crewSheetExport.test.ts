import test from "node:test";
import assert from "node:assert/strict";
import type { CrewScheduleSheet, ScheduleStop } from "@crewcue/contracts";
import {
  DEV_SCHEDULE_CHECKPOINT_TITLES,
  DEV_SCHEDULE_NOTE_BODIES,
  loadDevScheduleFixtureSheet,
  seedDevStopPlanOverlays
} from "./devScheduleFixture";
import {
  buildCrewSheetExportText,
  formatUtcHhMm,
  type CrewSheetNoteBodies
} from "./crewSheetExport";

const CAPTURED = "2026-08-13T21:00:00.000Z";

function noteBodiesFromDev(): Map<string, CrewSheetNoteBodies> {
  const map = new Map<string, CrewSheetNoteBodies>();
  for (const [id, bodies] of DEV_SCHEDULE_NOTE_BODIES) {
    map.set(id, {
      ...(bodies.athleteNotes ? { athleteNotes: bodies.athleteNotes.body } : {}),
      ...(bodies.planNotes ? { planNotes: bodies.planNotes.body } : {})
    });
  }
  return map;
}

test("formatUtcHhMm is locale-stable from ISO-Z (EC7)", () => {
  assert.equal(formatUtcHhMm("2026-08-15T14:10:00.000Z"), "14:10 UTC");
  assert.equal(formatUtcHhMm("2026-08-15T13:00:00.000Z"), "13:00 UTC");
  assert.equal(formatUtcHhMm("not-a-date"), "—");
});

test("happy path DEV fixture export lists stops + ISO clocks (EC1)", () => {
  const sheet = loadDevScheduleFixtureSheet();
  const text = buildCrewSheetExportText(sheet, {
    titleByCheckpointId: DEV_SCHEDULE_CHECKPOINT_TITLES,
    noteBodiesByCheckpointId: noteBodiesFromDev(),
    capturedAtIso: CAPTURED
  });

  assert.match(text, /CrewCue offline crew sheet/);
  assert.match(text, /no network refetch/i);
  assert.match(text, /Captured: 2026-08-13T21:00:00\.000Z/);
  assert.match(text, /Room: room-fixture-50k/);
  assert.match(text, /1\. Start/);
  assert.match(text, /Arrival: 2026-08-15T13:00:00\.000Z \(13:00 UTC\)/);
  assert.match(text, /2\. Aid 1/);
  assert.match(text, /Arrival: 2026-08-15T14:10:00\.000Z \(14:10 UTC\)/);
  assert.match(text, /3\. Aid 2/);
  assert.match(text, /Arrival: 2026-08-15T15:20:00\.000Z/);
  assert.match(text, /5\. Finish/);
  assert.match(text, /Stops: 5/);
});

test("empty / missing schedule yields clear empty copy (EC2)", () => {
  const missing = buildCrewSheetExportText(null, { capturedAtIso: CAPTURED });
  assert.match(missing, /No schedule loaded/);
  assert.doesNotMatch(missing, /Stops:/);

  const emptySheet: CrewScheduleSheet = {
    roomId: "room-empty",
    raceStartAt: "2026-08-15T13:00:00.000Z",
    stops: []
  };
  const empty = buildCrewSheetExportText(emptySheet, { capturedAtIso: CAPTURED });
  assert.match(empty, /No stops on this schedule/);
  assert.doesNotMatch(empty, /1\./);
});

test("notes + delay included when present (EC5)", () => {
  const base = loadDevScheduleFixtureSheet();
  const overlays = seedDevStopPlanOverlays(base);
  assert.ok(overlays.get("aid-2")?.delayOverrideSeconds === 120);

  const text = buildCrewSheetExportText(base, {
    titleByCheckpointId: DEV_SCHEDULE_CHECKPOINT_TITLES,
    noteBodiesByCheckpointId: noteBodiesFromDev(),
    capturedAtIso: CAPTURED
  });

  assert.match(text, /3\. Aid 2/);
  assert.match(text, /Delay: 02:00/);
  assert.match(text, /Plan notes: Drop bag \+ bottles/);
  assert.match(text, /4\. Aid 3/);
  assert.match(text, /Athlete notes: Need salt tabs/);
  assert.match(text, /Plan notes: Long crew meetup/);
});

test("cutoffStatus included when present; omitted when absent (EC6)", () => {
  const sheet = loadDevScheduleFixtureSheet();
  const without = buildCrewSheetExportText(sheet, {
    titleByCheckpointId: DEV_SCHEDULE_CHECKPOINT_TITLES,
    capturedAtIso: CAPTURED
  });
  assert.doesNotMatch(without, /Cutoff:/);

  const withCutoff: CrewScheduleSheet = {
    ...sheet,
    stops: sheet.stops.map((stop): ScheduleStop =>
      stop.checkpointId === "aid-1"
        ? { ...stop, cutoffStatus: "warn", cutoffMarginSeconds: 300 }
        : stop
    )
  };
  const text = buildCrewSheetExportText(withCutoff, {
    titleByCheckpointId: DEV_SCHEDULE_CHECKPOINT_TITLES,
    capturedAtIso: CAPTURED
  });
  assert.match(text, /2\. Aid 1/);
  assert.match(text, /Cutoff: warn \(margin 05:00 under\)/);
  assert.doesNotMatch(text, /3\. Aid 2[\s\S]*Cutoff:/);
});

test("export is pure snapshot — same inputs yield identical text (EC4)", () => {
  const sheet = loadDevScheduleFixtureSheet();
  const opts = {
    titleByCheckpointId: DEV_SCHEDULE_CHECKPOINT_TITLES,
    noteBodiesByCheckpointId: noteBodiesFromDev(),
    capturedAtIso: CAPTURED
  };
  const a = buildCrewSheetExportText(sheet, opts);
  const b = buildCrewSheetExportText(sheet, opts);
  assert.equal(a, b);
  assert.match(a, /built from the schedule already on device/i);
});
