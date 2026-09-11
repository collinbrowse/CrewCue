/**
 * W4-1 (#408): cutoff warnings on GET /schedule projection.
 *
 * Policy: UTC race-day wall clock for `time_of_day`; `CUTOFF_WARN_MARGIN_SECONDS` (900)
 * for warn band. Moving-time math unchanged — warnings consume projected arrivals only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CUTOFF_WARN_MARGIN_SECONDS,
  parseCrewScheduleSheet,
  type CrewScheduleSheet,
  type RaceCourseCheckpoint,
  type RaceRoom
} from "@crewcue/contracts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { getRaceRoom, saveRaceRoom } from "./raceRooms.js";
import { projectCrewScheduleSheet } from "./raceRoomSchedule.js";

const RACE_START_AT = "2026-08-15T13:00:00.000Z";

function findCutoffCompareFixture(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing/cutoff-compare.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing/cutoff-compare.json not found");
}

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

type TestApp = ReturnType<typeof buildApp>;

async function createPaidRoom(app: TestApp, ownerToken: string, name: string): Promise<string> {
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name,
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;
  const entitlement = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(entitlement.statusCode, 200);
  return roomId;
}

async function put50kCourse(
  app: TestApp,
  roomId: string,
  ownerToken: string,
  checkpointMutator?: (checkpoints: RaceCourseCheckpoint[]) => RaceCourseCheckpoint[]
) {
  const fixture = load50kCourseWithAids();
  const checkpoints = checkpointMutator
    ? checkpointMutator(fixture.checkpoints.map((cp) => ({ ...cp })))
    : fixture.checkpoints;
  const response = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as RaceRoom;
}

async function getSchedule(app: TestApp, roomId: string, token?: string) {
  return app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/schedule`,
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
}

function stopByCheckpoint(sheet: CrewScheduleSheet, checkpointId: string) {
  const stop = sheet.stops.find((row) => row.checkpointId === checkpointId);
  assert.ok(stop, `missing schedule stop ${checkpointId}`);
  return stop;
}

function applyCutoffById(
  checkpoints: RaceCourseCheckpoint[],
  byId: Record<string, RaceCourseCheckpoint["cutoff"]>
): RaceCourseCheckpoint[] {
  return checkpoints.map((cp) => {
    const cutoff = byId[cp.id];
    if (cutoff === undefined) {
      const next = { ...cp };
      delete next.cutoff;
      return next;
    }
    return { ...cp, cutoff };
  });
}

test("EC1 no cutoff on checkpoint → warning fields omitted; schedule 200", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec1"));
  const roomId = await createPaidRoom(app, ownerToken, "EC1 no cutoff");
  await put50kCourse(app, roomId, ownerToken, (cps) =>
    cps.map((cp) => {
      const next = { ...cp };
      delete next.cutoff;
      return next;
    })
  );

  const response = await getSchedule(app, roomId, ownerToken);
  assert.equal(response.statusCode, 200);
  const sheet = parseCrewScheduleSheet(response.json());
  for (const stop of sheet.stops) {
    assert.equal("cutoffStatus" in stop, false);
    assert.equal("cutoffMarginSeconds" in stop, false);
  }
  await app.close();
});

test("EC2 invalid cutoff shape on course write → 400 (unchanged reject)", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec2"));
  const roomId = await createPaidRoom(app, ownerToken, "EC2 invalid cutoff");
  const fixture = load50kCourseWithAids();
  const checkpoints = fixture.checkpoints.map((cp, index) =>
    index === 1
      ? {
          ...cp,
          cutoff: { mode: "time_of_day", hour: 25, minute: 0 }
        }
      : cp
  );

  const response = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(response.statusCode, 400);

  const badMode = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: {
        checkpoints: fixture.checkpoints.map((cp, index) =>
          index === 1 ? { ...cp, cutoff: { mode: "wall_clock", hour: 12, minute: 0 } } : cp
        )
      },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(badMode.statusCode, 400);
  await app.close();
});

test("EC3 unauthorized GET /schedule → 401 / 403", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec3"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-w41-ec3"));
  const roomId = await createPaidRoom(app, ownerToken, "EC3 cutoff authz");
  await put50kCourse(app, roomId, ownerToken);

  assert.equal((await getSchedule(app, roomId)).statusCode, 401);
  assert.equal((await getSchedule(app, roomId, strangerToken)).statusCode, 403);
  await app.close();
});

test("EC4 offline N/A in-process", () => {
  // Schedule projection is in-process HTTP; no offline client path in this package.
  assert.ok(true);
});

test("EC5 delay / check-in reproject can flip cutoff status", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec5"));
  const roomId = await createPaidRoom(app, ownerToken, "EC5 delay flips cutoff");

  // Seed without cutoff, project baseline aid-2 arrival, then set cutoff just above warn→ok margin.
  const seeded = await put50kCourse(app, roomId, ownerToken);
  const baseline = projectCrewScheduleSheet(seeded);
  const aid2 = stopByCheckpoint(baseline, "aid-2");
  // Cutoff = arrival + (warn margin + 60) → initially ok with margin = warn+60
  const cutoffElapsed = aid2.elapsedSeconds + CUTOFF_WARN_MARGIN_SECONDS + 60;

  const room = await getRaceRoom(roomId);
  assert.ok(room?.course);
  const withCutoff: RaceRoom = {
    ...room,
    course: {
      ...room.course,
      checkpoints: applyCutoffById(room.course.checkpoints, {
        "aid-2": { mode: "elapsed_from_start", seconds: cutoffElapsed }
      })
    }
  };
  await saveRaceRoom(withCutoff);

  const before = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const beforeAid2 = stopByCheckpoint(before, "aid-2");
  assert.equal(beforeAid2.cutoffStatus, "ok");
  assert.equal(beforeAid2.cutoffMarginSeconds, CUTOFF_WARN_MARGIN_SECONDS + 60);

  // Large delay at aid-1 pushes later clocks past cutoff → breach.
  const delayResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/stop-plans/aid-1`,
    payload: { delayOverrideSeconds: CUTOFF_WARN_MARGIN_SECONDS + 120 },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(delayResponse.statusCode, 200);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const afterAid2 = stopByCheckpoint(after, "aid-2");
  assert.equal(afterAid2.cutoffStatus, "breach");
  assert.ok((afterAid2.cutoffMarginSeconds ?? 0) < 0);
  await app.close();
});

test("EC6 ISO-Z clocks / elapsed seconds consistent for both cutoff modes", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec6"));
  const roomId = await createPaidRoom(app, ownerToken, "EC6 iso-z");

  // aid-1 elapsed ~4200 on 50k fixture pace; set matching time_of_day and elapsed cutoffs on two stops.
  const seeded = await put50kCourse(app, roomId, ownerToken, (cps) =>
    applyCutoffById(cps, {
      "aid-1": { mode: "elapsed_from_start", seconds: 10_000 },
      "aid-2": { mode: "time_of_day", hour: 18, minute: 0 }
    })
  );

  const response = await getSchedule(app, roomId, ownerToken);
  assert.equal(response.statusCode, 200);
  const sheet = parseCrewScheduleSheet(response.json());
  assert.match(sheet.raceStartAt, /Z$/);
  for (const stop of sheet.stops) {
    assert.match(stop.clockArrivalAt, /Z$/);
    assert.equal(typeof stop.elapsedSeconds, "number");
  }

  const aid1 = stopByCheckpoint(sheet, "aid-1");
  assert.equal(aid1.cutoffStatus, "ok");
  assert.equal(aid1.cutoffMarginSeconds, 10_000 - aid1.elapsedSeconds);

  const aid2 = stopByCheckpoint(sheet, "aid-2");
  const cutoffMs = Date.parse("2026-08-15T18:00:00.000Z");
  const arrivalMs = Date.parse(aid2.clockArrivalAt);
  assert.equal(aid2.cutoffMarginSeconds, Math.round((cutoffMs - arrivalMs) / 1000));
  assert.equal(aid2.cutoffStatus, "ok");

  // Pure projection matches GET body for cutoff fields.
  const projected = projectCrewScheduleSheet(seeded);
  assert.equal(stopByCheckpoint(projected, "aid-1").cutoffMarginSeconds, aid1.cutoffMarginSeconds);
  await app.close();
});

test("EC7 under cutoff (comfortably early) → ok", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec7"));
  const roomId = await createPaidRoom(app, ownerToken, "EC7 under");
  await put50kCourse(app, roomId, ownerToken, (cps) =>
    applyCutoffById(cps, {
      "aid-1": { mode: "elapsed_from_start", seconds: 50_000 }
    })
  );

  const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const aid1 = stopByCheckpoint(sheet, "aid-1");
  assert.equal(aid1.cutoffStatus, "ok");
  assert.ok((aid1.cutoffMarginSeconds ?? 0) > CUTOFF_WARN_MARGIN_SECONDS);
  await app.close();
});

test("EC8 on/near cutoff (warn margin) → warn", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec8"));
  const roomId = await createPaidRoom(app, ownerToken, "EC8 warn");

  const seeded = await put50kCourse(app, roomId, ownerToken);
  const baseline = projectCrewScheduleSheet(seeded);
  const aid1 = stopByCheckpoint(baseline, "aid-1");
  const cutoffElapsed = aid1.elapsedSeconds + 300; // 5 min margin → warn

  const room = await getRaceRoom(roomId);
  assert.ok(room?.course);
  await saveRaceRoom({
    ...room,
    course: {
      ...room.course,
      checkpoints: applyCutoffById(room.course.checkpoints, {
        "aid-1": { mode: "elapsed_from_start", seconds: cutoffElapsed }
      })
    }
  });

  const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const stop = stopByCheckpoint(sheet, "aid-1");
  assert.equal(stop.cutoffStatus, "warn");
  assert.equal(stop.cutoffMarginSeconds, 300);
  await app.close();
});

test("EC9 over cutoff → breach", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec9"));
  const roomId = await createPaidRoom(app, ownerToken, "EC9 breach");

  const seeded = await put50kCourse(app, roomId, ownerToken);
  const baseline = projectCrewScheduleSheet(seeded);
  const aid1 = stopByCheckpoint(baseline, "aid-1");
  const cutoffElapsed = aid1.elapsedSeconds - 120;

  const room = await getRaceRoom(roomId);
  assert.ok(room?.course);
  await saveRaceRoom({
    ...room,
    course: {
      ...room.course,
      checkpoints: applyCutoffById(room.course.checkpoints, {
        "aid-1": { mode: "elapsed_from_start", seconds: cutoffElapsed }
      })
    }
  });

  const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const stop = stopByCheckpoint(sheet, "aid-1");
  assert.equal(stop.cutoffStatus, "breach");
  assert.equal(stop.cutoffMarginSeconds, -120);
  await app.close();
});

test("EC10 time_of_day vs elapsed_from_start both compare correctly", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w41-ec10"));
  const roomId = await createPaidRoom(app, ownerToken, "EC10 both modes");

  const fixtureJson = JSON.parse(readFileSync(findCutoffCompareFixture(), "utf8")) as {
    raceStartAt: string;
    warnMarginSeconds: number;
    cases: Array<{ id: string; mode: string }>;
  };
  assert.equal(fixtureJson.raceStartAt, RACE_START_AT);
  assert.equal(fixtureJson.warnMarginSeconds, CUTOFF_WARN_MARGIN_SECONDS);
  assert.ok(fixtureJson.cases.some((row) => row.mode === "time_of_day"));
  assert.ok(fixtureJson.cases.some((row) => row.mode === "elapsed_from_start"));

  const seeded = await put50kCourse(app, roomId, ownerToken);
  const baseline = projectCrewScheduleSheet(seeded);
  const aid1Elapsed = stopByCheckpoint(baseline, "aid-1").elapsedSeconds;

  // Build cutoffs from fixture cases relative to live projected aid-1 arrival where needed.
  const room = await getRaceRoom(roomId);
  assert.ok(room?.course);
  const byId: Record<string, RaceCourseCheckpoint["cutoff"]> = {
    "aid-1": { mode: "elapsed_from_start", seconds: aid1Elapsed + 2000 },
    "aid-2": { mode: "time_of_day", hour: 15, minute: 30 },
    "aid-3": { mode: "elapsed_from_start", seconds: stopByCheckpoint(baseline, "aid-3").elapsedSeconds },
    finish: { mode: "time_of_day", hour: 12, minute: 0 }
  };
  await saveRaceRoom({
    ...room,
    course: {
      ...room.course,
      checkpoints: applyCutoffById(room.course.checkpoints, byId)
    }
  });

  const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.equal(stopByCheckpoint(sheet, "aid-1").cutoffStatus, "ok");
  assert.equal(stopByCheckpoint(sheet, "aid-1").cutoffMarginSeconds, 2000);

  const aid2 = stopByCheckpoint(sheet, "aid-2");
  const expectedAid2Margin = Math.round(
    (Date.parse("2026-08-15T15:30:00.000Z") - Date.parse(aid2.clockArrivalAt)) / 1000
  );
  assert.equal(aid2.cutoffMarginSeconds, expectedAid2Margin);
  assert.equal(aid2.cutoffStatus, expectedAid2Margin <= 0 ? "breach" : expectedAid2Margin <= CUTOFF_WARN_MARGIN_SECONDS ? "warn" : "ok");

  assert.equal(stopByCheckpoint(sheet, "aid-3").cutoffStatus, "breach");
  assert.equal(stopByCheckpoint(sheet, "aid-3").cutoffMarginSeconds, 0);

  // finish cutoff 12:00Z is before race start 13:00Z → always breach on UTC race-day policy
  const finish = stopByCheckpoint(sheet, "finish");
  assert.equal(finish.cutoffStatus, "breach");
  assert.ok((finish.cutoffMarginSeconds ?? 0) < 0);

  // start has no cutoff
  assert.equal("cutoffStatus" in stopByCheckpoint(sheet, "start"), false);
  await app.close();
});
