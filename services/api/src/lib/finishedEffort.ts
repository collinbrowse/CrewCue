/**
 * Builds the finished-effort record for a room the moment its runner crosses the finish
 * (plan PR 6): plan accuracy, the runner's measured slowdown, and each stop.
 */
import type { RaceCourse, RaceRoomProjectionCore } from "@crewcue/contracts";
import type { CourseMetricPoint } from "@crewcue/map-core";
import type { FinishedEffort, FinishedStop } from "./finishedEffortStore.js";
import { sunElevationDegrees } from "./pacingEstimate/microModel/sun.js";
import { NIGHT_SUN_ELEVATION_DEGREES } from "./projectionTuning.js";
import { hasUsableBaselineTrack, plannedElapsedSecondsForDistance } from "./raceProjection.js";
import { measureSlowdownSlope, unfadedPlanCurve, type TimedSection } from "./runnerSlowdown.js";

/** True when this projection is the first to show the finish checkpoint crossed. */
export function justFinished(
  previousCrossed: Record<string, string> | undefined,
  core: RaceRoomProjectionCore,
  course: RaceCourse
): boolean {
  const finish = course.checkpoints[course.checkpoints.length - 1];
  if (!finish || course.checkpoints.length < 2) return false;
  const row = core.checkpointSplits.find((r) => r.checkpointId === finish.id);
  return Boolean(row?.crossedAtRecordedAt) && !previousCrossed?.[finish.id];
}

export function buildFinishedEffort(input: {
  roomId: string;
  athleteUserId: string;
  course: RaceCourse;
  core: RaceRoomProjectionCore;
  routeMetricPoints: CourseMetricPoint[];
  raceAnchorIso: string;
  plannedPaceSecondsPerKm: number;
}): FinishedEffort | null {
  const { course, core } = input;
  const splits = core.checkpointSplits;
  const finish = splits[splits.length - 1];
  if (!finish?.crossedAtRecordedAt || finish.actualElapsedSecondsAtCross == null) return null;
  const startMs = Date.parse(input.raceAnchorIso);
  const length = core.courseLengthMeters;
  const actualFinishSeconds = finish.actualElapsedSecondsAtCross;

  // Plan accuracy: the plan's moving finish plus its planned stops.
  let plannedFinishSeconds: number | undefined;
  if (hasUsableBaselineTrack(course.baselineTrack, length)) {
    const plannedStops = splits.reduce((sum, row) => sum + row.plannedStopSeconds, 0);
    plannedFinishSeconds =
      plannedElapsedSecondsForDistance({
        distanceMetersFromStart: length,
        plannedPaceSecondsPerKm: input.plannedPaceSecondsPerKm,
        baselineTrack: course.baselineTrack,
        courseLengthMeters: length
      }) + plannedStops;
  }

  // Slowdown: moving time between consecutive crossings vs the unfaded cold-start shape.
  const plan = unfadedPlanCurve(input.routeMetricPoints);
  const scale = plan.lengthMeters > 0 ? plan.lengthMeters / length : 1;
  const sections: TimedSection[] = [];
  const stopAt = (i: number) =>
    splits[i]!.visits.reduce((sum, visit) => sum + (visit.activeActualStopSeconds ?? 0), 0);
  for (let i = 1; i < splits.length; i += 1) {
    const a = splits[i - 1]!;
    const b = splits[i]!;
    if (a.actualElapsedSecondsAtCross == null || b.actualElapsedSecondsAtCross == null) continue;
    const actualSeconds = b.actualElapsedSecondsAtCross - a.actualElapsedSecondsAtCross - stopAt(i - 1);
    const plannedSeconds =
      plan.plannedAt(b.distanceMetersFromStart * scale) - plan.plannedAt(a.distanceMetersFromStart * scale);
    sections.push({ startMeters: a.distanceMetersFromStart, endMeters: b.distanceMetersFromStart, actualSeconds, plannedSeconds });
  }
  const slowdownSlope = measureSlowdownSlope(sections, length);

  const stops: FinishedStop[] = [];
  splits.forEach((row, i) => {
    if (i === 0 || i === splits.length - 1 || row.totalActualStopSeconds == null) return;
    const checkpoint = course.checkpoints.find((cp) => cp.id === row.checkpointId);
    const arrivedMs = row.crossedAtRecordedAt ? Date.parse(row.crossedAtRecordedAt) : Number.NaN;
    const dark =
      checkpoint && !Number.isNaN(arrivedMs)
        ? sunElevationDegrees(arrivedMs, checkpoint.latitude, checkpoint.longitude) < NIGHT_SUN_ELEVATION_DEGREES
        : false;
    stops.push({
      checkpointId: row.checkpointId,
      tags: checkpoint?.tags ?? [],
      plannedStopSeconds: row.plannedStopSeconds,
      actualStopSeconds: row.totalActualStopSeconds,
      progress: length > 0 ? row.distanceMetersFromStart / length : 0,
      dark
    });
  });

  return {
    roomId: input.roomId,
    athleteUserId: input.athleteUserId,
    finishedAt: new Date(startMs + actualFinishSeconds * 1000).toISOString(),
    courseLengthMeters: length,
    actualFinishSeconds,
    ...(plannedFinishSeconds !== undefined && plannedFinishSeconds > 0
      ? { plannedFinishSeconds, planLogError: Math.log(actualFinishSeconds / plannedFinishSeconds) }
      : {}),
    ...(course.baselineTrack?.planProfileBranch ? { planBranch: course.baselineTrack.planProfileBranch } : {}),
    ...(slowdownSlope !== null ? { slowdownSlope } : {}),
    stops
  };
}
