/**
 * #538 / #493: who may change a race room's plan-of-record pacing estimate, and why.
 *
 * - The race athlete (`room.athleteId`) may update it for any reason, including automatic
 *   recomputes when their history changes.
 * - Every crew role (crew member, crew chief, team manager) may only seed a cold start while
 *   the room has no plan of record, or explicitly Recalculate. Either way the estimate is built
 *   from the athlete's history and owned by the athlete. This is the issue's wording ("crew may
 *   only seed a cold start or tap Recalculate") and matches client-core `PlanAuthority`.
 * - Everyone else may not change the plan.
 */
import { z } from "zod";
import type { RaceRoom } from "@crewcue/contracts";

/** Mirrors client-core `PlanAuthority.mayExplicitRecalculate` / `maySeedColdStart`. */
export const PLAN_CREW_ROLES: readonly string[] = ["crew_member", "crew_chief", "team_manager"];

export const planTriggerSchema = z.enum(["auto", "cold_start", "recalculate"]);
export type PlanTrigger = z.infer<typeof planTriggerSchema>;

export type PlanAuthorityDecision =
  | { ok: true; historyOwnerUserId: string }
  | { ok: false; status: 403; error: string; code: "plan_authority" };

export function isRoomAthlete(room: Pick<RaceRoom, "athleteId">, userId: string): boolean {
  return room.athleteId === userId;
}

export function decidePlanAuthority(input: {
  room: Pick<RaceRoom, "athleteId" | "pacingEstimateId">;
  userId: string;
  /** The caller's membership role in the room. */
  role: string;
  trigger: PlanTrigger;
}): PlanAuthorityDecision {
  const { room, userId, role, trigger } = input;
  if (isRoomAthlete(room, userId)) {
    return { ok: true, historyOwnerUserId: userId };
  }
  if (!PLAN_CREW_ROLES.includes(role)) {
    return deny("Only the athlete or the crew may change the plan of record");
  }
  if (trigger === "auto") {
    return deny("Only the athlete's history updates the plan of record automatically");
  }
  if (trigger === "cold_start" && room.pacingEstimateId !== undefined) {
    return deny("The room already has a plan of record; use Recalculate");
  }
  return { ok: true, historyOwnerUserId: room.athleteId };
}

function deny(error: string): PlanAuthorityDecision {
  return { ok: false, status: 403, error, code: "plan_authority" };
}
