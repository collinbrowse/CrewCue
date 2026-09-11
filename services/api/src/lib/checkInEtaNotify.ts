/**
 * W2-2 (#386): notify entitled room members when a closed check-in materially
 * shifts later GET /schedule ETAs.
 *
 * Reuses chat push devices + notification prefs + `dispatchChatPush`.
 * Prefs: only `all` receives ETA alerts; `mentions` and `none` are skipped
 * (ETA shift is not a mention).
 *
 * Threshold: any later-stop clock shift of ≥ {@link CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS}.
 * Shift magnitude follows W2-1 contribution math: closed actual replaces
 * planned stoppage + delayOverride at the check-in checkpoint (LWW absolute).
 */
import type { FastifyBaseLogger } from "fastify";
import {
  chatChannelIdForRoom,
  type ChatNotificationPref,
  type RaceRoom
} from "@crewcue/contracts";
import {
  listChatNotificationPrefsForUsers,
  listChatPushDevicesForUsers
} from "./chatPersistence.js";
import {
  dispatchChatPush,
  tokensToTargets,
  type ChatPushDispatchResult
} from "./chatPushDispatch.js";

/** Documented material-shift threshold for check-in ETA notify (seconds). */
export const CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS = 60;

export type CheckInEtaShiftDirection = "early" | "late";

export type MaterialCheckInEtaShift = {
  checkpointId: string;
  checkpointLabel: string;
  /** Positive = later arrivals (late); negative = earlier (early). */
  signedShiftSeconds: number;
  maxAbsShiftSeconds: number;
  direction: CheckInEtaShiftDirection;
};

export type CheckInEtaNotifyResult = {
  attempted: boolean;
  reason?:
    | "no_later_stops"
    | "below_threshold"
    | "no_eligible_recipients"
    | "no_devices"
    | "dispatched"
    | "dispatch_failed";
  shift?: MaterialCheckInEtaShift;
  dispatch?: ChatPushDispatchResult;
};

function checkpointDistanceMeters(room: RaceRoom, checkpointId: string): number | undefined {
  const checkpoint = room.course?.checkpoints.find((row) => row.id === checkpointId);
  const distance = checkpoint?.distanceMetersFromStart;
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
    return undefined;
  }
  return distance;
}

function plannedContributionSeconds(room: RaceRoom, checkpointId: string): number {
  const checkpoint = room.course?.checkpoints.find((row) => row.id === checkpointId);
  const plannedStoppageSeconds = Math.max(0, checkpoint?.plannedStopSeconds ?? 0);
  const delayOverrideSeconds = room.stopPlans?.find((plan) => plan.checkpointId === checkpointId)
    ?.delayOverrideSeconds;
  return plannedStoppageSeconds + (delayOverrideSeconds !== undefined ? delayOverrideSeconds : 0);
}

function contributionSeconds(
  room: RaceRoom,
  checkpointId: string,
  closedActualByCheckpointId: ReadonlyMap<string, number>
): number {
  const closed = closedActualByCheckpointId.get(checkpointId);
  if (typeof closed === "number" && Number.isFinite(closed)) {
    return closed;
  }
  return plannedContributionSeconds(room, checkpointId);
}

export function hasLaterScheduleStops(room: RaceRoom, checkpointId: string): boolean {
  const selfDistance = checkpointDistanceMeters(room, checkpointId);
  if (selfDistance === undefined) {
    return false;
  }
  return (room.course?.checkpoints ?? []).some((checkpoint) => {
    const distance = checkpoint.distanceMetersFromStart;
    return typeof distance === "number" && Number.isFinite(distance) && distance > selfDistance;
  });
}

export function checkpointLabelForNotify(room: RaceRoom, checkpointId: string): string {
  const title = room.course?.checkpoints.find((row) => row.id === checkpointId)?.title?.trim();
  return title && title.length > 0 ? title : checkpointId;
}

/**
 * Measure the uniform later-stop ETA shift caused by changing the check-in
 * checkpoint's closed-actual contribution (W2-1 absolute / LWW).
 */
export function measureMaterialCheckInEtaShift(input: {
  room: RaceRoom;
  checkpointId: string;
  beforeClosedActualByCheckpointId: ReadonlyMap<string, number>;
  afterClosedActualByCheckpointId: ReadonlyMap<string, number>;
  thresholdSeconds?: number;
}): MaterialCheckInEtaShift | null {
  const threshold = input.thresholdSeconds ?? CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS;
  if (!hasLaterScheduleStops(input.room, input.checkpointId)) {
    return null;
  }
  const before = contributionSeconds(
    input.room,
    input.checkpointId,
    input.beforeClosedActualByCheckpointId
  );
  const after = contributionSeconds(
    input.room,
    input.checkpointId,
    input.afterClosedActualByCheckpointId
  );
  const signedShiftSeconds = after - before;
  const maxAbsShiftSeconds = Math.abs(signedShiftSeconds);
  if (maxAbsShiftSeconds < threshold) {
    return null;
  }
  return {
    checkpointId: input.checkpointId,
    checkpointLabel: checkpointLabelForNotify(input.room, input.checkpointId),
    signedShiftSeconds,
    maxAbsShiftSeconds,
    direction: signedShiftSeconds >= 0 ? "late" : "early"
  };
}

/** Format shift magnitude in whole minutes when ≥ 60s, otherwise seconds (EC6). */
export function formatEtaShiftMagnitude(absSeconds: number): string {
  const rounded = Math.round(Math.abs(absSeconds));
  if (rounded >= 60) {
    const minutes = Math.round(rounded / 60);
    return `${minutes} min`;
  }
  return `${rounded} sec`;
}

/** Crew-safe preview: checkpoint label + early/late magnitude. No secrets. */
export function formatCheckInEtaNotifyPreview(shift: MaterialCheckInEtaShift): string {
  const magnitude = formatEtaShiftMagnitude(shift.maxAbsShiftSeconds);
  return `${shift.checkpointLabel} check-in: later stops ~${magnitude} ${shift.direction}`;
}

/**
 * Prefs for schedule ETA alerts: only `all`. `mentions` skips (not a mention);
 * `none` skips. Default when unset is `all` (same as chat webhook).
 */
export function isPrefEligibleForCheckInEtaNotify(pref: ChatNotificationPref): boolean {
  return pref === "all";
}

export async function notifyEntitledMembersOfCheckInEtaShift(input: {
  room: RaceRoom;
  actorUserId: string;
  checkpointId: string;
  beforeClosedActualByCheckpointId: ReadonlyMap<string, number>;
  afterClosedActualByCheckpointId: ReadonlyMap<string, number>;
  log: FastifyBaseLogger;
  thresholdSeconds?: number;
}): Promise<CheckInEtaNotifyResult> {
  const shift = measureMaterialCheckInEtaShift({
    room: input.room,
    checkpointId: input.checkpointId,
    beforeClosedActualByCheckpointId: input.beforeClosedActualByCheckpointId,
    afterClosedActualByCheckpointId: input.afterClosedActualByCheckpointId,
    thresholdSeconds: input.thresholdSeconds
  });
  if (!shift) {
    const noLater = !hasLaterScheduleStops(input.room, input.checkpointId);
    return {
      attempted: false,
      reason: noLater ? "no_later_stops" : "below_threshold"
    };
  }

  // Room entitlement is already gated on the write path; unpaid rooms never reach here.
  const candidateUserIds = input.room.memberships
    .map((member) => member.userId)
    .filter((userId) => userId !== input.actorUserId);

  if (candidateUserIds.length === 0) {
    return { attempted: false, reason: "no_eligible_recipients", shift };
  }

  const prefs = await listChatNotificationPrefsForUsers(candidateUserIds, input.room.id);
  const eligibleUserIds = candidateUserIds.filter((userId) => {
    const explicit = prefs.find((row) => row.userId === userId);
    const pref: ChatNotificationPref = explicit?.preference ?? "all";
    return isPrefEligibleForCheckInEtaNotify(pref);
  });

  if (eligibleUserIds.length === 0) {
    return { attempted: false, reason: "no_eligible_recipients", shift };
  }

  const tokens = await listChatPushDevicesForUsers(eligibleUserIds);
  if (tokens.length === 0) {
    return { attempted: false, reason: "no_devices", shift };
  }

  const previewText = formatCheckInEtaNotifyPreview(shift);
  try {
    const dispatch = await dispatchChatPush({
      channelId: chatChannelIdForRoom(input.room.id),
      roomId: input.room.id,
      previewText,
      targets: tokensToTargets(tokens),
      genericFallback: "Crew schedule updated"
    });
    input.log.info(
      {
        checkInEtaNotify: {
          roomId: input.room.id,
          checkpointId: input.checkpointId,
          actorUserId: input.actorUserId,
          maxAbsShiftSeconds: shift.maxAbsShiftSeconds,
          direction: shift.direction,
          delivered: dispatch.delivered,
          attempts: dispatch.attempts
        }
      },
      "check_in_eta_notify_dispatched"
    );
    return { attempted: true, reason: "dispatched", shift, dispatch };
  } catch (err) {
    input.log.warn(
      { err, roomId: input.room.id, checkpointId: input.checkpointId },
      "check_in_eta_notify_failed"
    );
    return { attempted: true, reason: "dispatch_failed", shift };
  }
}
