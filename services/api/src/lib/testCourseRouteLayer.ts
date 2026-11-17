import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MapWorkspaceLayer, RaceCourseCheckpoint } from "@crewcue/contracts";
import { buildRaceCourseFromGpx, geodesicDistanceMeters, parseGpxTrack, parsedTrackToWorkspaceLayer } from "@crewcue/map-core";

/** Minimal LineString overlay for integration tests (merged as primary course route on PUT /course). */
export function lineStringRouteOverlayForCheckpoints(
  checkpoints: Array<{ latitude: number; longitude: number }>
): MapWorkspaceLayer {
  return {
    id: "integration-test-route",
    label: "integration",
    visible: true,
    geometry: {
      type: "LineString",
      coordinates: checkpoints.map((c) => [c.longitude, c.latitude] as [number, number])
    }
  };
}

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "course-50k-with-aids.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing/course-50k-with-aids.gpx not found");
}

let cached50k: {
  checkpoints: RaceCourseCheckpoint[];
  routeOverlayLayer: MapWorkspaceLayer;
  plannedPaceSecondsPerKm: number;
} | undefined;

/** Parsed W0-2 50k course + route overlay for waypoint CRUD tests. */
export function load50kCourseWithAids(): {
  checkpoints: RaceCourseCheckpoint[];
  routeOverlayLayer: MapWorkspaceLayer;
  plannedPaceSecondsPerKm: number;
} {
  if (cached50k) {
    return {
      checkpoints: cached50k.checkpoints.map((checkpoint) => ({ ...checkpoint })),
      routeOverlayLayer: cached50k.routeOverlayLayer,
      plannedPaceSecondsPerKm: cached50k.plannedPaceSecondsPerKm
    };
  }
  const xml = readFileSync(resolve(findPacingFixturesDir(), "course-50k-with-aids.gpx"), "utf8");
  const parsed = parseGpxTrack(xml);
  const { course, plannedPaceSecondsPerKm } = buildRaceCourseFromGpx(parsed);
  cached50k = {
    checkpoints: course.checkpoints,
    routeOverlayLayer: parsedTrackToWorkspaceLayer("course-50k-with-aids.gpx", parsed),
    plannedPaceSecondsPerKm
  };
  return load50kCourseWithAids();
}

/**
 * A position on the 50k fixture's route `metersBeforeEnd` before its end, walking back along its
 * legs: where a checkpoint short of the route's end sits.
 */
export function pointOn50kRouteBeforeEnd(metersBeforeEnd: number): { latitude: number; longitude: number } {
  const geometry = load50kCourseWithAids().routeOverlayLayer.geometry;
  if (geometry.type !== "LineString") {
    throw new Error("the 50k route is a LineString");
  }
  const coordinates = geometry.coordinates;
  let left = metersBeforeEnd;
  for (let index = coordinates.length - 1; index > 0; index -= 1) {
    const [lonA, latA] = coordinates[index - 1]!;
    const [lonB, latB] = coordinates[index]!;
    const leg = geodesicDistanceMeters({ latitude: latA, longitude: lonA }, { latitude: latB, longitude: lonB });
    if (left <= leg) {
      const t = leg > 0 ? 1 - left / leg : 0;
      return { latitude: latA + t * (latB - latA), longitude: lonA + t * (lonB - lonA) };
    }
    left -= leg;
  }
  throw new Error(`the 50k route is shorter than ${metersBeforeEnd} m`);
}
