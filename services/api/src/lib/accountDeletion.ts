/**
 * Account deletion (#560, App Store 5.1.1(v), Google Play account deletion).
 *
 * Order matters:
 * 1. Rooms. Runner-owned rooms close for everyone (room, invites, runtime, track, chat channel,
 *    finished effort, course-history record). In rooms someone else owns, only the membership and
 *    the user's invites go; their event-log entries are re-attributed to a placeholder.
 * 2. Per-user stores: activity history, pacing estimates, finished efforts, chat push devices and
 *    prefs, Strava (deauthorize at Strava best effort, then delete tokens and OAuth state).
 * 3. Stream user (hard delete), when Stream credentials are set.
 * 4. Auth0 user last. If it fails the caller returns 502 and the client keeps the session, so a
 *    retry (every step above is idempotent) can finish the job.
 */
import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDeletionResult } from "@crewcue/contracts";
import { chatChannelIdForRoom } from "@crewcue/contracts";
import { StreamChat } from "stream-chat";
import {
  deleteRaceRoomForAccountDeletion,
  listRaceRoomsForAccount,
  removeMemberForAccountDeletion
} from "../routes/raceRooms.js";
import { resolveStravaClientConfig } from "../routes/stravaRoutes.js";
import { deleteActivityHistoryForAthlete } from "./activityHistoryStore.js";
import { deletePacingEstimatesForAthlete } from "./pacingEstimateStore.js";
import { deleteFinishedEffortForRoom, deleteFinishedEffortsForAthlete } from "./finishedEffortStore.js";
import { deleteChatDataForUser, deleteChatRoomData } from "./chatPersistence.js";
import { deleteCrewCueRoomCourseHistory } from "./courseHistory/store.js";
import {
  deleteOAuthPendingStatesForAthlete,
  deleteStravaConnection,
  getStravaConnection
} from "./stravaConnectionStore.js";
import { deauthorizeStravaAccess } from "./strava/stravaClient.js";
import { DELETED_ACCOUNT_ACTOR, forgetPlatformEventsForAccountDeletion } from "./platformEventLog.js";
import { anonymizePersistedPlatformEventActor } from "./roomPersistence.js";
import { deriveStreamUserId, readStreamCredentials } from "./streamChat.js";
import {
  deleteAuth0User,
  isAuth0Subject,
  readAuth0ManagementConfig,
  type Auth0ManagementConfig,
  type FetchLike
} from "./auth0Management.js";

/** Stream cleanup seam: hard-delete owned-room channels, then the user. */
export type StreamAccountCleanup = (input: { streamUserId: string; ownedRoomIds: string[] }) => Promise<void>;

export type AccountDeletionDeps = {
  /** Defaults to env (`AUTH0_MGMT_*`). `null` forces "not configured". */
  auth0Config?: Auth0ManagementConfig | null;
  auth0Fetch?: FetchLike;
  /** Defaults to Stream SDK when `STREAM_API_KEY`/`STREAM_API_SECRET` are set; else skipped. */
  streamCleanup?: StreamAccountCleanup | null;
};

export class IdentityDeletionError extends Error {
  constructor(readonly cause: unknown) {
    super("identity provider deletion failed");
    this.name = "IdentityDeletionError";
  }
}

let depsOverrideForTests: AccountDeletionDeps | undefined;

export function setAccountDeletionDepsForTests(deps: AccountDeletionDeps | undefined): void {
  depsOverrideForTests = deps;
}

/** Log-safe stand-in for the subject (audit lines carry no PII). */
export function hashedSubject(sub: string): string {
  return createHash("sha256").update(sub, "utf8").digest("hex").slice(0, 16);
}

function defaultStreamCleanup(): StreamAccountCleanup | null {
  const creds = readStreamCredentials();
  if (!creds) return null;
  return async ({ streamUserId, ownedRoomIds }) => {
    const client = StreamChat.getInstance(creds.apiKey, creds.apiSecret, { timeout: 20_000 });
    for (const roomId of ownedRoomIds) {
      try {
        await client.channel("messaging", chatChannelIdForRoom(roomId)).delete({ hard_delete: true });
      } catch (err) {
        if (!isStreamNotFound(err)) throw err;
      }
    }
    try {
      await client.deleteUser(streamUserId, { hard_delete: true, mark_messages_deleted: true });
    } catch (err) {
      if (!isStreamNotFound(err)) throw err;
    }
  };
}

function isStreamNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  return e?.code === 16 || e?.status === 404 || e?.response?.status === 404;
}

export async function deleteAccountData(
  identity: { sub: string; email?: string },
  log: FastifyBaseLogger,
  depsInput: AccountDeletionDeps = depsOverrideForTests ?? {}
): Promise<AccountDeletionResult> {
  const { sub } = identity;
  const subjectHash = hashedSubject(sub);

  // 1. Rooms.
  const rooms = await listRaceRoomsForAccount(sub);
  const ownedRoomIds: string[] = [];
  let membershipsRemoved = 0;
  for (const room of rooms) {
    if (room.athleteId === sub) {
      await deleteRaceRoomForAccountDeletion(room.id);
      await deleteChatRoomData(room.id);
      await deleteFinishedEffortForRoom(room.id);
      await deleteCrewCueRoomCourseHistory(room.id);
      ownedRoomIds.push(room.id);
    } else if (await removeMemberForAccountDeletion(room.id, sub, identity.email, log)) {
      membershipsRemoved += 1;
    }
  }
  forgetPlatformEventsForAccountDeletion({ roomIds: ownedRoomIds, actorUserId: sub });
  await anonymizePersistedPlatformEventActor(sub, DELETED_ACCOUNT_ACTOR);

  // 2. Per-user stores.
  const activityHistoryDeleted = await deleteActivityHistoryForAthlete(sub);
  const pacingEstimatesDeleted = await deletePacingEstimatesForAthlete(sub);
  const finishedEffortsDeleted = await deleteFinishedEffortsForAthlete(sub);
  const chat = await deleteChatDataForUser(sub);

  const strava = await getStravaConnection(sub);
  const stravaConfig = resolveStravaClientConfig();
  if (strava && stravaConfig) {
    try {
      await deauthorizeStravaAccess(stravaConfig, strava);
    } catch (err) {
      log.warn({ err, subject: subjectHash }, "account_deletion_strava_deauthorize_failed");
    }
  }
  const stravaDisconnected = await deleteStravaConnection(sub);
  await deleteOAuthPendingStatesForAthlete(sub);

  // 3. Stream.
  const streamCleanup = depsInput.streamCleanup === undefined ? defaultStreamCleanup() : depsInput.streamCleanup;
  if (streamCleanup) {
    try {
      await streamCleanup({ streamUserId: deriveStreamUserId(sub), ownedRoomIds });
    } catch (err) {
      // Owned rooms are already gone server-side; a stale Stream user has no room access left.
      log.error({ err, subject: subjectHash }, "account_deletion_stream_failed");
    }
  }

  // 4. Identity provider.
  let identityProvider: AccountDeletionResult["identityProvider"];
  const auth0Config = depsInput.auth0Config === undefined ? readAuth0ManagementConfig() : depsInput.auth0Config;
  if (!isAuth0Subject(sub)) {
    identityProvider = "not_applicable";
  } else if (!auth0Config) {
    identityProvider = "not_configured";
    log.warn({ subject: subjectHash }, "account_deletion_auth0_not_configured");
  } else {
    try {
      identityProvider = await deleteAuth0User(auth0Config, sub, depsInput.auth0Fetch);
    } catch (err) {
      log.error({ err, subject: subjectHash }, "account_deletion_auth0_failed");
      throw new IdentityDeletionError(err);
    }
  }

  const result: AccountDeletionResult = {
    deleted: true,
    roomsClosed: ownedRoomIds.length,
    membershipsRemoved,
    activityHistoryDeleted,
    pacingEstimatesDeleted,
    finishedEffortsDeleted,
    pushDevicesDeleted: chat.pushDevicesPurged,
    chatPrefsDeleted: chat.prefsPurged,
    stravaDisconnected,
    identityProvider
  };
  log.info({ accountDeletion: { subject: subjectHash, ...result } }, "account_deleted");
  return result;
}
