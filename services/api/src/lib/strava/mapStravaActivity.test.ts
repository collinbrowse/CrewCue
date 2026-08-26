import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseActivityHistoryRef } from "@crewcue/contracts";
import {
  isStravaRunLikeActivity,
  mapStravaActivityToHistoryRef,
  stravaExternalId
} from "./mapStravaActivity.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "strava-activity-summary.json"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const fixture = JSON.parse(
  readFileSync(resolve(findPacingFixturesDir(), "strava-activity-summary.json"), "utf8")
) as Record<string, unknown>;

test("EC1: map fixture summary → valid ActivityHistoryRef", () => {
  const ref = mapStravaActivityToHistoryRef({
    id: fixture.id as number,
    distance: fixture.distance as number,
    elapsed_time: fixture.elapsed_time as number,
    moving_time: fixture.moving_time as number,
    total_elevation_gain: fixture.total_elevation_gain as number,
    start_date: fixture.start_date as string,
    type: fixture.type as string,
    sport_type: fixture.sport_type as string
  });
  const replay = parseActivityHistoryRef(ref);
  assert.equal(replay.source, "strava");
  assert.equal(replay.externalId, stravaExternalId(fixture.id as number));
  assert.equal(replay.distanceMeters, 8000);
  assert.equal(replay.elapsedSeconds, 2520);
  assert.equal(replay.elevationGainMeters, 40);
  assert.match(replay.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(replay.ingestedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("stravaExternalId normalizes id and accepts prefixed form", () => {
  assert.equal(stravaExternalId(42), "strava:42");
  assert.equal(stravaExternalId("strava:99"), "strava:99");
});

test("isStravaRunLikeActivity accepts run sports and rejects rides/swims", () => {
  assert.equal(isStravaRunLikeActivity({ id: 1, type: "Run" }), true);
  assert.equal(isStravaRunLikeActivity({ id: 1, sport_type: "TrailRun" }), true);
  assert.equal(isStravaRunLikeActivity({ id: 1, type: "VirtualRun" }), true);
  assert.equal(isStravaRunLikeActivity({ id: 1 }), true);
  assert.equal(isStravaRunLikeActivity({ id: 1, type: "Ride", sport_type: "MountainBikeRide" }), false);
  assert.equal(isStravaRunLikeActivity({ id: 1, type: "Swim" }), false);
  assert.equal(isStravaRunLikeActivity({ id: 1, type: "Hike" }), false);
});

test("mapStravaActivityToHistoryRef rejects non-run sports", () => {
  assert.throws(
    () =>
      mapStravaActivityToHistoryRef({
        id: 99,
        distance: 40_000,
        elapsed_time: 4800,
        type: "Ride",
        sport_type: "Ride"
      }),
    /not a run-like sport/
  );
});
