/**
 * CrewCue finished-room source: one runner's stored track → a one-effort course-history event.
 *
 * The track is replayed through `recomputeRaceProjection`, the same code a live room runs on each
 * ping, so checkpoint crossings and detected stops match what crews saw. Per checkpoint:
 * - in  = arrival inside the checkpoint radius (the first visit), else the along-route crossing;
 * - out = in + the detected stop, when a stop was detected.
 *
 * Narrow on purpose: it takes an ordered list of points, not PR 1's `room_athlete_pings` table.
 * Wiring it to stored tracks (`GET /pings/track`) happens once PR 1 lands.
 */
import type { RaceCourse } from "@crewcue/contracts";
import type { CourseMetricPoint } from "@crewcue/map-core";
import { recomputeRaceProjection, type ProjectionPreviousState } from "../../raceProjection.js";
import {
  COURSE_HISTORY_FORMAT_VERSION,
  validateCourseHistoryEvent,
  type CourseHistoryEvent,
  type CourseHistorySplit
} from "../format.js";

export type TrackPoint = { recordedAt: string; latitude: number; longitude: number };

export type CrewCueRoomInput = {
  roomId: string;
  name: string;
  /** Race start; split times are elapsed from here. */
  raceStartAt: string;
  /** The room's course; every checkpoint needs `distanceMetersFromStart` (set on course save). */
  course: RaceCourse;
  /** Dense route polyline. Defaults to the checkpoint polyline when the room has no route layer. */
  routeMetricPoints?: CourseMetricPoint[];
  /** The runner's points, ordered by `recordedAt`. */
  track: TrackPoint[];
};

/** Null when the runner never reached the finish (course history holds finishers only). */
export function crewCueRoomToCourseHistoryEvent(input: CrewCueRoomInput): CourseHistoryEvent | null {
  const { course, track } = input;
  if (track.length === 0 || course.checkpoints.length < 2) {
    return null;
  }
  const startMs = Date.parse(input.raceStartAt);
  const route =
    input.routeMetricPoints && input.routeMetricPoints.length >= 2
      ? input.routeMetricPoints
      : course.checkpoints.map((cp) => ({ latitude: cp.latitude, longitude: cp.longitude }));

  let previous: ProjectionPreviousState | null = null;
  let previousPing: (TrackPoint & { pingId: string }) | null = null;
  let last: ReturnType<typeof recomputeRaceProjection> | null = null;
  for (const [index, point] of track.entries()) {
    if (Date.parse(point.recordedAt) < startMs) {
      continue;
    }
    const ping = { pingId: `${input.roomId}-${index}`, ...point };
    last = recomputeRaceProjection({
      roomId: input.roomId,
      activatedAt: input.raceStartAt,
      course,
      plannedPaceSecondsPerKm: 480,
      ping,
      previousPing,
      previous,
      routeMetricPoints: route
    });
    previous = last.state;
    previousPing = ping;
  }
  if (!last) {
    return null;
  }

  const elapsed = (iso: string | null | undefined) => (iso ? (Date.parse(iso) - startMs) / 1000 : null);
  const rows = last.projection.checkpointSplits;
  const splits: CourseHistorySplit[] = [];
  let lastTime = 0;
  rows.forEach((row, index) => {
    if (index === 0) {
      return;
    }
    const visit = row.visits[0];
    const inSeconds = elapsed(visit?.autoDetected?.arrivalRecordedAt) ?? row.actualElapsedSecondsAtCross;
    if (inSeconds === null || inSeconds < lastTime) {
      return; // never reached, or a GPS glitch put it out of order
    }
    const stop = row.totalActualStopSeconds ?? 0;
    const isFinish = index === rows.length - 1;
    const split: CourseHistorySplit = {
      checkpointId: row.checkpointId,
      inSeconds,
      ...(!isFinish && stop > 0 ? { outSeconds: inSeconds + stop } : {})
    };
    splits.push(split);
    lastTime = split.outSeconds ?? inSeconds;
  });

  const finishId = course.checkpoints[course.checkpoints.length - 1]!.id;
  if (splits[splits.length - 1]?.checkpointId !== finishId) {
    return null;
  }

  const event: CourseHistoryEvent = {
    formatVersion: COURSE_HISTORY_FORMAT_VERSION,
    source: "crewcue",
    sourceEventId: input.roomId,
    name: input.name,
    startTime: new Date(startMs).toISOString(),
    checkpoints: course.checkpoints.map((cp) => ({
      id: cp.id,
      name: cp.title ?? cp.id,
      distanceMeters: cp.distanceMetersFromStart ?? 0,
      latitude: cp.latitude,
      longitude: cp.longitude
    })),
    efforts: [{ splits }]
  };
  const checked = validateCourseHistoryEvent(event);
  if (!checked.ok) {
    throw new Error(`crewcue room ${input.roomId}: ${checked.errors.join("; ")}`);
  }
  return checked.event;
}
