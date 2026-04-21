import type {
  ProjectionWeatherStub,
  RaceCourse,
  RaceCourseCheckpoint,
  RaceRoomProjectionCore,
  RaceCheckpointSplitRow
} from "@crewcue/contracts";

const EARTH_RADIUS_M = 6_371_000;
const EPS_M = 0.05;

export const DEFAULT_PLANNED_PACE_SECONDS_PER_KM = 480;

/** Default straight-line course (~2.2 km) used when activation omits `course`. */
export const DEFAULT_RACE_COURSE: RaceCourse = {
  checkpoints: [
    { id: "cp-start", latitude: 36.5, longitude: -118.5 },
    { id: "cp-mid", latitude: 36.51, longitude: -118.5 },
    { id: "cp-finish", latitude: 36.52, longitude: -118.5 }
  ]
};

type XY = { x: number; y: number };

function toLocalXY(originLat: number, originLon: number, lat: number, lon: number): XY {
  const φ = ((lat - originLat) * Math.PI) / 180;
  const λ = ((lon - originLon) * Math.PI) / 180;
  const φ0 = (originLat * Math.PI) / 180;
  return { x: EARTH_RADIUS_M * Math.cos(φ0) * λ, y: EARTH_RADIUS_M * φ };
}

/** Cumulative distance at each checkpoint along the polyline in local XY space (matches progress math). */
export function cumulativeDistanceAtCheckpoints(checkpoints: RaceCourseCheckpoint[]): number[] {
  const lat0 = checkpoints[0].latitude;
  const lon0 = checkpoints[0].longitude;
  const xy = checkpoints.map((p) => toLocalXY(lat0, lon0, p.latitude, p.longitude));
  const cum: number[] = [0];
  for (let i = 0; i < xy.length - 1; i++) {
    const dx = xy[i + 1].x - xy[i].x;
    const dy = xy[i + 1].y - xy[i].y;
    cum.push(cum[cum.length - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return cum;
}

type Candidate = { distSq: number; segIndex: number; t: number; progress: number };

function betterCandidate(a: Candidate, b: Candidate): boolean {
  if (a.distSq < b.distSq - 1e-12) return true;
  if (Math.abs(a.distSq - b.distSq) > 1e-12) return false;
  if (a.segIndex < b.segIndex) return true;
  if (a.segIndex > b.segIndex) return false;
  return a.t < b.t - 1e-15;
}

/**
 * Closest point on polyline (local equirectangular space) and distance along the path to that point.
 * Tie-break: lower segment index, then lower clamped projection parameter `t`.
 */
export function polylineCourseLengthAndProgress(
  checkpoints: RaceCourseCheckpoint[],
  pingLat: number,
  pingLon: number
): { courseLengthMeters: number; progressMeters: number } {
  const lat0 = checkpoints[0].latitude;
  const lon0 = checkpoints[0].longitude;
  const xy = checkpoints.map((p) => toLocalXY(lat0, lon0, p.latitude, p.longitude));
  const pxy = toLocalXY(lat0, lon0, pingLat, pingLon);

  let courseLength = 0;
  const segLens: number[] = [];
  for (let i = 0; i < xy.length - 1; i++) {
    const dx = xy[i + 1].x - xy[i].x;
    const dy = xy[i + 1].y - xy[i].y;
    segLens.push(Math.sqrt(dx * dx + dy * dy));
    courseLength += segLens[i];
  }

  let best: Candidate = { distSq: Number.POSITIVE_INFINITY, segIndex: 999999, t: 1, progress: courseLength };
  let cumBefore = 0;

  for (let i = 0; i < xy.length - 1; i++) {
    const A = xy[i];
    const B = xy[i + 1];
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const apx = pxy.x - A.x;
    const apy = pxy.y - A.y;
    const ab2 = abx * abx + aby * aby;
    const tRaw = ab2 < 1e-18 ? 0 : (apx * abx + apy * aby) / ab2;
    const t = Math.min(1, Math.max(0, tRaw));
    const cx = A.x + t * abx;
    const cy = A.y + t * aby;
    const dx = pxy.x - cx;
    const dy = pxy.y - cy;
    const distSq = dx * dx + dy * dy;
    const segLen = segLens[i];
    const progress = cumBefore + t * segLen;
    const cand: Candidate = { distSq, segIndex: i, t, progress };
    if (betterCandidate(cand, best)) {
      best = cand;
    }
    cumBefore += segLen;
  }

  const progressMeters = Math.min(courseLength, Math.max(0, best.progress));
  return { courseLengthMeters: courseLength, progressMeters };
}

export type ProjectionPing = {
  pingId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

export type ProjectionPreviousState = {
  lastProgressMeters: number;
  splitCrossedAt: Record<string, string>;
};

/** Deterministic headwind assumption by course progress (Chunk D1 stub until a weather provider exists). */
export function buildProjectionWeatherStub(input: {
  progressMeters: number;
  courseLengthMeters: number;
}): ProjectionWeatherStub {
  const ratio =
    input.courseLengthMeters > 0 ? input.progressMeters / input.courseLengthMeters : 0;
  const segment =
    ratio < 1 / 3 ? "early_course" : ratio < 2 / 3 ? "mid_course" : "late_course";
  const assumedHeadwindMps =
    segment === "early_course" ? 2.0 : segment === "mid_course" ? 1.2 : 0.6;
  return {
    source: "stub",
    summary: `Synthetic baseline (${segment.replace("_", " ")}); replace with a weather provider when available.`,
    assumedHeadwindMps
  };
}

export function recomputeRaceProjection(params: {
  roomId: string;
  activatedAt: string;
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
  ping: ProjectionPing;
  previous: ProjectionPreviousState | null;
}): { projection: RaceRoomProjectionCore; state: ProjectionPreviousState } {
  const { roomId, activatedAt, course, plannedPaceSecondsPerKm, ping, previous } = params;
  const activatedAtMs = Date.parse(activatedAt);
  const recordedAtMs = Date.parse(ping.recordedAt);
  if (Number.isNaN(activatedAtMs) || Number.isNaN(recordedAtMs)) {
    throw new Error("Invalid ISO timestamps for projection");
  }

  const { courseLengthMeters, progressMeters } = polylineCourseLengthAndProgress(
    course.checkpoints,
    ping.latitude,
    ping.longitude
  );

  const cumAt = cumulativeDistanceAtCheckpoints(course.checkpoints);
  const splitCrossedAt: Record<string, string> = { ...previous?.splitCrossedAt };

  if (previous === null) {
    splitCrossedAt[course.checkpoints[0].id] = activatedAt;
  }

  const prevProgress = previous?.lastProgressMeters ?? -1;
  for (let k = 1; k < course.checkpoints.length; k++) {
    const at = cumAt[k];
    const crossed = progressMeters + EPS_M >= at && prevProgress < at - EPS_M;
    if (crossed && !splitCrossedAt[course.checkpoints[k].id]) {
      splitCrossedAt[course.checkpoints[k].id] = ping.recordedAt;
    }
  }

  const checkpointSplits: RaceCheckpointSplitRow[] = course.checkpoints.map((cp, k) => {
    const at = cumAt[k];
    const crossedAt = splitCrossedAt[cp.id] ?? null;
    const plannedElapsedSecondsAtCross = (at / 1000) * plannedPaceSecondsPerKm;
    let actualElapsedSecondsAtCross: number | null = null;
    let deltaSecondsAtCross: number | null = null;
    if (crossedAt) {
      const crossMs = Date.parse(crossedAt);
      if (!Number.isNaN(crossMs)) {
        actualElapsedSecondsAtCross = (crossMs - activatedAtMs) / 1000;
        deltaSecondsAtCross = actualElapsedSecondsAtCross - plannedElapsedSecondsAtCross;
      }
    }
    return {
      checkpointId: cp.id,
      distanceMetersFromStart: at,
      crossedAtRecordedAt: crossedAt,
      plannedElapsedSecondsAtCross,
      actualElapsedSecondsAtCross,
      deltaSecondsAtCross
    };
  });

  const remainingM = Math.max(0, courseLengthMeters - progressMeters);
  const remainingSec = (remainingM / 1000) * plannedPaceSecondsPerKm;
  const etaFinishPlanIso = new Date(recordedAtMs + remainingSec * 1000).toISOString();

  const projection: RaceRoomProjectionCore = {
    roomId,
    asOfPingId: ping.pingId,
    asOfRecordedAt: ping.recordedAt,
    progressMeters,
    courseLengthMeters,
    plannedPaceSecondsPerKm,
    etaFinishPlanIso,
    checkpointSplits,
    weatherStub: buildProjectionWeatherStub({ progressMeters, courseLengthMeters })
  };

  return {
    projection,
    state: {
      lastProgressMeters: progressMeters,
      splitCrossedAt
    }
  };
}
