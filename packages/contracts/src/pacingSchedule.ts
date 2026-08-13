/**
 * Additive DTOs for crew schedule ops + AI history pacing (Wave 0-1).
 * Compose with `RaceCourseCheckpoint` via `checkpointId` / optional `tags`;
 * do not introduce a parallel course model.
 *
 * Units: clock times are ISO-8601 UTC strings; durations are seconds; distances are meters.
 */

/** Closed operational tags for a course waypoint. A stop may have several. */
export const WAYPOINT_TAGS = ["aid", "water", "dropbag", "crew"] as const;

export type WaypointTag = (typeof WAYPOINT_TAGS)[number];

/** Provenance for an athlete activity used as pacing history. */
export const ACTIVITY_HISTORY_SOURCES = ["gpx_upload", "strava"] as const;

export type ActivityHistorySource = (typeof ACTIVITY_HISTORY_SOURCES)[number];

/** Optional A/B confidence bands on a pacing estimate (not UltraPacer strategy knobs). */
export const PACING_BAND_KINDS = ["conservative", "expected", "aggressive"] as const;

export type PacingBandKind = (typeof PACING_BAND_KINDS)[number];

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Parse a clock timestamp.
 * @returns the same string when it is a valid ISO-8601 UTC instant (`…Z`).
 */
export function parseIso8601Utc(value: unknown, field = "timestamp"): string {
  const text = requireNonEmptyString(value, field);
  if (!ISO_8601_UTC.test(text) || Number.isNaN(Date.parse(text))) {
    throw new TypeError(`${field} must be an ISO-8601 UTC string`);
  }
  return text;
}

/**
 * Parse a duration or elapsed value.
 * @returns a finite number of seconds ≥ 0.
 */
export function parseDurationSeconds(value: unknown, field = "durationSeconds"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite number of seconds`);
  }
  return value;
}

/**
 * Parse a distance.
 * @returns a finite number of meters ≥ 0.
 */
export function parseDistanceMeters(value: unknown, field = "distanceMeters"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite number of meters`);
  }
  return value;
}

export function isWaypointTag(value: unknown): value is WaypointTag {
  return typeof value === "string" && (WAYPOINT_TAGS as readonly string[]).includes(value);
}

export function isActivityHistorySource(value: unknown): value is ActivityHistorySource {
  return typeof value === "string" && (ACTIVITY_HISTORY_SOURCES as readonly string[]).includes(value);
}

export function isPacingBandKind(value: unknown): value is PacingBandKind {
  return typeof value === "string" && (PACING_BAND_KINDS as readonly string[]).includes(value);
}

/**
 * Parse waypoint tags. Empty list is valid (untagged landmark). Invalid strings are rejected
 * (no silent coerce). Duplicates are preserved as given.
 */
export function parseWaypointTags(value: unknown, field = "tags"): WaypointTag[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  const tags: WaypointTag[] = [];
  for (const item of value) {
    if (!isWaypointTag(item)) {
      throw new TypeError(`${field} contains invalid waypoint tag: ${String(item)}`);
    }
    tags.push(item);
  }
  return tags;
}

/**
 * References to per-stop note records (athlete vs plan). Omit the object or any id when unused.
 */
export interface ScheduleStopNotesRef {
  athleteNotesId?: string;
  planNotesId?: string;
}

/**
 * Athlete- or plan-authored note stored on the race-room overlay (not on `RaceCourseCheckpoint`).
 * Empty `body` (including whitespace-only) clears that note. `id` is stable for `ScheduleStopNotesRef`.
 */
export interface StopPlanNote {
  id: string;
  body: string;
}

/**
 * Plan-scoped overlay for one course checkpoint.
 * `delayOverrideSeconds` is extra dwell on top of `plannedStopSeconds` / `plannedDwellSeconds`;
 * it does not replace planned dwell and must not mutate checkpoint geometry or tags.
 */
export interface RaceRoomStopPlan {
  checkpointId: string;
  delayOverrideSeconds?: number;
  athleteNotes?: StopPlanNote;
  planNotes?: StopPlanNote;
}

/**
 * One row of the crew schedule sheet: clock arrival **and** elapsed, plus dwell.
 * `checkpointId` matches `RaceCourseCheckpoint.id`.
 */
export interface ScheduleStop {
  id: string;
  checkpointId: string;
  /** Planned clock arrival (ISO-8601 UTC). */
  clockArrivalAt: string;
  /** Elapsed seconds from race start. */
  elapsedSeconds: number;
  /** Planned dwell at this stop, seconds. */
  plannedDwellSeconds: number;
  /**
   * Optional extra dwell seconds beyond `plannedDwellSeconds` (crew meetup, drop-bag, etc.).
   * Omit when the typical dwell applies.
   */
  delayOverrideSeconds?: number;
  notes?: ScheduleStopNotesRef;
}

/**
 * Pointer to a stored past activity. `source` + `externalId` is the stable idempotency key
 * for later ingest replay.
 */
export interface ActivityHistoryRef {
  id: string;
  source: ActivityHistorySource;
  /** Provider activity id or upload fingerprint; stable across retries. */
  externalId: string;
  /** When the activity was recorded (ISO-8601 UTC). */
  recordedAt: string;
  /** When CrewCue ingested the activity (ISO-8601 UTC). */
  ingestedAt: string;
  distanceMeters?: number;
  elapsedSeconds?: number;
  elevationGainMeters?: number;
}

/** Finish (or equivalent) instant for one confidence band. */
export interface PacingTimePoint {
  /** Clock finish (ISO-8601 UTC). */
  finishAt: string;
  finishElapsedSeconds: number;
}

/** Expected arrival at a tagged aid (or other) checkpoint. */
export interface PacingAidEta {
  checkpointId: string;
  /** Clock arrival (ISO-8601 UTC). */
  clockArrivalAt: string;
  elapsedSeconds: number;
}

/**
 * AI / estimator output that feeds the crew schedule.
 * `coldStart: true` means no athlete history was used; `historyRefIds` may be omitted.
 */
export interface PacingEstimate {
  id: string;
  coldStart: boolean;
  expectedFinishAt: string;
  expectedFinishElapsedSeconds: number;
  aidEtas: PacingAidEta[];
  bands?: Partial<Record<PacingBandKind, PacingTimePoint>>;
  /** Short human-readable rationale for crew UIs. */
  explanation: string;
  /** History rows that backed this estimate; omit or empty on cold-start. */
  historyRefIds?: string[];
}

/**
 * Fixture-friendly crew schedule sheet (clock + elapsed rows).
 * W0-2 golden JSON (`fixtures/pacing/schedule-expected.json`) should match this shape.
 */
export interface CrewScheduleSheet {
  roomId: string;
  /** Official race start (ISO-8601 UTC). */
  raceStartAt: string;
  stops: ScheduleStop[];
  pacingEstimateId?: string;
}

function parseNotesRef(value: unknown, field: string): ScheduleStopNotesRef {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const notes: ScheduleStopNotesRef = {};
  if (value.athleteNotesId !== undefined) {
    notes.athleteNotesId = requireNonEmptyString(value.athleteNotesId, `${field}.athleteNotesId`);
  }
  if (value.planNotesId !== undefined) {
    notes.planNotesId = requireNonEmptyString(value.planNotesId, `${field}.planNotesId`);
  }
  return notes;
}

export function parseScheduleStop(value: unknown, field = "scheduleStop"): ScheduleStop {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const stop: ScheduleStop = {
    id: requireNonEmptyString(value.id, `${field}.id`),
    checkpointId: requireNonEmptyString(value.checkpointId, `${field}.checkpointId`),
    clockArrivalAt: parseIso8601Utc(value.clockArrivalAt, `${field}.clockArrivalAt`),
    elapsedSeconds: parseDurationSeconds(value.elapsedSeconds, `${field}.elapsedSeconds`),
    plannedDwellSeconds: parseDurationSeconds(value.plannedDwellSeconds, `${field}.plannedDwellSeconds`)
  };
  if (value.delayOverrideSeconds !== undefined) {
    stop.delayOverrideSeconds = parseDurationSeconds(
      value.delayOverrideSeconds,
      `${field}.delayOverrideSeconds`
    );
  }
  if (value.notes !== undefined) {
    stop.notes = parseNotesRef(value.notes, `${field}.notes`);
  }
  return stop;
}

export function parseActivityHistoryRef(value: unknown, field = "activityHistoryRef"): ActivityHistoryRef {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  if (!isActivityHistorySource(value.source)) {
    throw new TypeError(`${field}.source must be gpx_upload or strava`);
  }
  const ref: ActivityHistoryRef = {
    id: requireNonEmptyString(value.id, `${field}.id`),
    source: value.source,
    externalId: requireNonEmptyString(value.externalId, `${field}.externalId`),
    recordedAt: parseIso8601Utc(value.recordedAt, `${field}.recordedAt`),
    ingestedAt: parseIso8601Utc(value.ingestedAt, `${field}.ingestedAt`)
  };
  if (value.distanceMeters !== undefined) {
    ref.distanceMeters = parseDistanceMeters(value.distanceMeters, `${field}.distanceMeters`);
  }
  if (value.elapsedSeconds !== undefined) {
    ref.elapsedSeconds = parseDurationSeconds(value.elapsedSeconds, `${field}.elapsedSeconds`);
  }
  if (value.elevationGainMeters !== undefined) {
    ref.elevationGainMeters = parseDistanceMeters(
      value.elevationGainMeters,
      `${field}.elevationGainMeters`
    );
  }
  return ref;
}

function parsePacingTimePoint(value: unknown, field: string): PacingTimePoint {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return {
    finishAt: parseIso8601Utc(value.finishAt, `${field}.finishAt`),
    finishElapsedSeconds: parseDurationSeconds(value.finishElapsedSeconds, `${field}.finishElapsedSeconds`)
  };
}

function parsePacingAidEta(value: unknown, field: string): PacingAidEta {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return {
    checkpointId: requireNonEmptyString(value.checkpointId, `${field}.checkpointId`),
    clockArrivalAt: parseIso8601Utc(value.clockArrivalAt, `${field}.clockArrivalAt`),
    elapsedSeconds: parseDurationSeconds(value.elapsedSeconds, `${field}.elapsedSeconds`)
  };
}

function parsePacingBands(
  value: unknown,
  field: string
): Partial<Record<PacingBandKind, PacingTimePoint>> {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const bands: Partial<Record<PacingBandKind, PacingTimePoint>> = {};
  for (const key of Object.keys(value)) {
    if (!isPacingBandKind(key)) {
      throw new TypeError(`${field} contains invalid band: ${key}`);
    }
    bands[key] = parsePacingTimePoint(value[key], `${field}.${key}`);
  }
  return bands;
}

export function parsePacingEstimate(value: unknown, field = "pacingEstimate"): PacingEstimate {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  if (typeof value.coldStart !== "boolean") {
    throw new TypeError(`${field}.coldStart must be a boolean`);
  }
  if (!Array.isArray(value.aidEtas)) {
    throw new TypeError(`${field}.aidEtas must be an array`);
  }
  const estimate: PacingEstimate = {
    id: requireNonEmptyString(value.id, `${field}.id`),
    coldStart: value.coldStart,
    expectedFinishAt: parseIso8601Utc(value.expectedFinishAt, `${field}.expectedFinishAt`),
    expectedFinishElapsedSeconds: parseDurationSeconds(
      value.expectedFinishElapsedSeconds,
      `${field}.expectedFinishElapsedSeconds`
    ),
    aidEtas: value.aidEtas.map((row, index) => parsePacingAidEta(row, `${field}.aidEtas[${index}]`)),
    explanation: requireNonEmptyString(value.explanation, `${field}.explanation`)
  };
  if (value.bands !== undefined) {
    estimate.bands = parsePacingBands(value.bands, `${field}.bands`);
  }
  if (value.historyRefIds !== undefined) {
    if (!Array.isArray(value.historyRefIds)) {
      throw new TypeError(`${field}.historyRefIds must be an array`);
    }
    estimate.historyRefIds = value.historyRefIds.map((id, index) =>
      requireNonEmptyString(id, `${field}.historyRefIds[${index}]`)
    );
  }
  return estimate;
}

export function parseCrewScheduleSheet(value: unknown, field = "crewScheduleSheet"): CrewScheduleSheet {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  if (!Array.isArray(value.stops)) {
    throw new TypeError(`${field}.stops must be an array`);
  }
  const sheet: CrewScheduleSheet = {
    roomId: requireNonEmptyString(value.roomId, `${field}.roomId`),
    raceStartAt: parseIso8601Utc(value.raceStartAt, `${field}.raceStartAt`),
    stops: value.stops.map((stop, index) => parseScheduleStop(stop, `${field}.stops[${index}]`))
  };
  if (value.pacingEstimateId !== undefined) {
    sheet.pacingEstimateId = requireNonEmptyString(value.pacingEstimateId, `${field}.pacingEstimateId`);
  }
  return sheet;
}
