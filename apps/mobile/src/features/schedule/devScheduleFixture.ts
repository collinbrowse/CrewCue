import {
  parseCrewScheduleSheet,
  type CrewScheduleSheet,
  type ScheduleStop,
  type ScheduleStopNotesRef,
  type StopPlanNote
} from "@crewcue/contracts";
import scheduleExpected from "../../../../../fixtures/pacing/schedule-expected.json";
import type { ManualCheckpointStopInput, StopPlanResponse, UpsertStopPlanInput } from "../../api/client";
import { assertValidUpsertStopPlanInput } from "../../api/client";
import { closedCheckInActualStopSeconds } from "./checkInValidation";

/**
 * DEV-only schedule sheet from `fixtures/pacing/schedule-expected.json`.
 * Used by `crewcue://dev/schedule-sheet` so simulator QA can assert stop rows without Auth0.
 * Never used as a production auth/session bypass.
 */
export function loadDevScheduleFixtureSheet(): CrewScheduleSheet {
  return parseCrewScheduleSheet(scheduleExpected.sheet);
}

/** Stable titles for fixture checkpoint ids (display-only; clocks still from API fixture). */
export const DEV_SCHEDULE_CHECKPOINT_TITLES: ReadonlyMap<string, string> = new Map([
  ["start", "Start"],
  ["aid-1", "Aid 1"],
  ["aid-2", "Aid 2"],
  ["aid-3", "Aid 3"],
  ["finish", "Finish"]
]);

/** Seed note bodies for fixture stops that only expose note ids on the sheet. */
export const DEV_SCHEDULE_NOTE_BODIES: ReadonlyMap<string, { athleteNotes?: StopPlanNote; planNotes?: StopPlanNote }> =
  new Map([
    [
      "aid-2",
      {
        planNotes: { id: "note-plan-aid-2", body: "Drop bag + bottles" }
      }
    ],
    [
      "aid-3",
      {
        athleteNotes: { id: "note-athlete-aid-3", body: "Need salt tabs" },
        planNotes: { id: "note-plan-aid-3", body: "Long crew meetup" }
      }
    ]
  ]);

export type DevStopPlanOverlay = {
  delayOverrideSeconds?: number;
  athleteNotes?: StopPlanNote;
  planNotes?: StopPlanNote;
};

function resolveNote(
  incoming: { id?: string; body: string } | null | undefined,
  existing: StopPlanNote | undefined,
  fieldPresent: boolean
): StopPlanNote | undefined {
  if (!fieldPresent) {
    return existing;
  }
  if (incoming === null || incoming === undefined) {
    return undefined;
  }
  if (incoming.body.trim().length === 0) {
    return undefined;
  }
  const id = incoming.id?.trim() || existing?.id || `dev-note-${Math.random().toString(36).slice(2, 10)}`;
  return { id, body: incoming.body };
}

/** Mirror W1-2 `applyStopPlanUpsert` for in-memory DEV fixture saves. */
export function applyDevStopPlanUpsert(
  existing: DevStopPlanOverlay | undefined,
  checkpointId: string,
  patch: UpsertStopPlanInput
): DevStopPlanOverlay | undefined {
  assertValidUpsertStopPlanInput(patch);

  let delayOverrideSeconds = existing?.delayOverrideSeconds;
  if (patch.delayOverrideSeconds !== undefined) {
    delayOverrideSeconds = patch.delayOverrideSeconds === null ? undefined : patch.delayOverrideSeconds;
  }

  const athleteNotes = resolveNote(patch.athleteNotes, existing?.athleteNotes, patch.athleteNotes !== undefined);
  const planNotes = resolveNote(patch.planNotes, existing?.planNotes, patch.planNotes !== undefined);

  if (delayOverrideSeconds === undefined && !athleteNotes && !planNotes) {
    return undefined;
  }
  return {
    ...(delayOverrideSeconds !== undefined ? { delayOverrideSeconds } : {}),
    ...(athleteNotes ? { athleteNotes } : {}),
    ...(planNotes ? { planNotes } : {})
  };
}

/**
 * Apply a closed check-in (arrival+departure) for the DEV fixture.
 * Returns absolute actual stop seconds (LWW overwrite for the checkpoint).
 */
export function applyDevClosedCheckIn(input: ManualCheckpointStopInput): number {
  return closedCheckInActualStopSeconds(input);
}

function notesRefFromOverlay(overlay: DevStopPlanOverlay | undefined): ScheduleStopNotesRef | undefined {
  if (!overlay?.athleteNotes && !overlay?.planNotes) {
    return undefined;
  }
  const notes: ScheduleStopNotesRef = {};
  if (overlay.athleteNotes) {
    notes.athleteNotesId = overlay.athleteNotes.id;
  }
  if (overlay.planNotes) {
    notes.planNotesId = overlay.planNotes.id;
  }
  return notes;
}

/**
 * Apply overlay delay delta + closed check-in actuals to later stops' elapsed/clock
 * (same cumulative rule as API projection: closed actual replaces planned stoppage + delay).
 * Used only by the DEV fixture so sim QA can see refreshed clocks without Auth0.
 * Production path must refetch `getSchedule` instead.
 *
 * When `overlays.has(checkpointId)` the overlay is authoritative (including empty `{}` after clear).
 * Otherwise the base fixture stop is used unchanged aside from cumulative clock shifts.
 */
export function projectDevSheetWithOverlays(
  baseSheet: CrewScheduleSheet,
  overlays: ReadonlyMap<string, DevStopPlanOverlay>,
  closedActualStopSecondsByCheckpointId?: ReadonlyMap<string, number>
): CrewScheduleSheet {
  const raceStartMs = Date.parse(baseSheet.raceStartAt);
  let cumulativeShiftSeconds = 0;
  const stops: ScheduleStop[] = baseSheet.stops.map((stop) => {
    const baseDelay = stop.delayOverrideSeconds ?? 0;
    const hasOverlay = overlays.has(stop.checkpointId);
    const overlay = hasOverlay ? overlays.get(stop.checkpointId) : undefined;
    const nextDelay = hasOverlay ? overlay?.delayOverrideSeconds : stop.delayOverrideSeconds;
    const delayForPlan = typeof nextDelay === "number" ? nextDelay : 0;
    const plannedContribution = stop.plannedStoppageSeconds + delayForPlan;
    const baseContribution = stop.plannedStoppageSeconds + baseDelay;
    const closedActual = closedActualStopSecondsByCheckpointId?.get(stop.checkpointId);

    // Own arrival uses prior cumulative shift only (own stoppage/actual does not shift own clock).
    const elapsedSeconds = stop.elapsedSeconds + cumulativeShiftSeconds;
    const next: ScheduleStop = {
      id: stop.id,
      checkpointId: stop.checkpointId,
      clockArrivalAt: new Date(raceStartMs + elapsedSeconds * 1000).toISOString(),
      elapsedSeconds,
      plannedStoppageSeconds: stop.plannedStoppageSeconds
    };
    if (typeof nextDelay === "number") {
      next.delayOverrideSeconds = nextDelay;
    }
    if (hasOverlay) {
      const notes = notesRefFromOverlay(overlay);
      if (notes) {
        next.notes = notes;
      }
    } else if (stop.notes) {
      next.notes = stop.notes;
    }

    // Shift later stops: closed actual replaces planned+delay; else delay overlay delta vs base.
    if (typeof closedActual === "number" && Number.isFinite(closedActual)) {
      cumulativeShiftSeconds += closedActual - baseContribution;
    } else {
      cumulativeShiftSeconds += plannedContribution - baseContribution;
    }
    return next;
  });

  return {
    ...baseSheet,
    stops
  };
}

export function overlayToStopPlanResponse(
  roomId: string,
  checkpointId: string,
  overlay: DevStopPlanOverlay | undefined
): StopPlanResponse {
  return {
    roomId,
    checkpointId,
    ...(overlay?.delayOverrideSeconds !== undefined
      ? { delayOverrideSeconds: overlay.delayOverrideSeconds }
      : {}),
    ...(overlay?.athleteNotes ? { athleteNotes: overlay.athleteNotes } : {}),
    ...(overlay?.planNotes ? { planNotes: overlay.planNotes } : {})
  };
}

/** Seed overlays from the golden fixture (delay + note bodies). */
export function seedDevStopPlanOverlays(sheet: CrewScheduleSheet): Map<string, DevStopPlanOverlay> {
  const map = new Map<string, DevStopPlanOverlay>();
  for (const stop of sheet.stops) {
    const bodies = DEV_SCHEDULE_NOTE_BODIES.get(stop.checkpointId);
    const hasDelay = typeof stop.delayOverrideSeconds === "number";
    if (!hasDelay && !bodies) {
      continue;
    }
    map.set(stop.checkpointId, {
      ...(hasDelay ? { delayOverrideSeconds: stop.delayOverrideSeconds } : {}),
      ...(bodies?.athleteNotes ? { athleteNotes: bodies.athleteNotes } : {}),
      ...(bodies?.planNotes ? { planNotes: bodies.planNotes } : {})
    });
  }
  return map;
}
