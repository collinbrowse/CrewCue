/**
 * Account routes (#560): `DELETE /me` deletes the signed-in user's account and data;
 * `GET /me/export` returns their data as JSON. See src/lib/accountDeletion.ts for what is removed.
 */
import type { FastifyInstance } from "fastify";
import type { AccountDataExport } from "@crewcue/contracts";
import { deleteAccountData, IdentityDeletionError } from "../lib/accountDeletion.js";
import { listActivityHistoryForAthlete } from "../lib/activityHistoryStore.js";
import { listPacingEstimatesForAthlete } from "../lib/pacingEstimateStore.js";
import { getStravaConnectionPublic } from "../lib/stravaConnectionStore.js";
import { listRaceRoomsForAccount } from "./raceRooms.js";

/** One deletion per user at a time; a double-tap waits for the first and replays as zeros. */
const inflight = new Map<string, Promise<unknown>>();

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.delete("/me", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const previous = inflight.get(identity.sub);
    if (previous) await previous.catch(() => undefined);
    const run = deleteAccountData({ sub: identity.sub, email: identity.email }, request.log);
    inflight.set(identity.sub, run);
    try {
      return reply.send(await run);
    } catch (err) {
      if (err instanceof IdentityDeletionError) {
        return reply.code(502).send({
          error: "Your data was deleted but signing you out of CrewCue's identity provider failed. Try again.",
          code: "identity_delete_failed",
          retryable: true
        });
      }
      throw err;
    } finally {
      if (inflight.get(identity.sub) === run) inflight.delete(identity.sub);
    }
  });

  app.get("/me/export", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const sub = identity.sub;
    const rooms = await listRaceRoomsForAccount(sub);
    const body: AccountDataExport = {
      exportedAt: new Date().toISOString(),
      userId: sub,
      rooms: rooms.map((room) => {
        const membership = room.memberships.find((m) => m.userId === sub);
        return {
          id: room.id,
          name: room.name,
          role: membership?.role ?? "runner",
          ownedAsRunner: room.athleteId === sub,
          ...(membership?.joinedAt ? { joinedAt: membership.joinedAt } : {}),
          ...(membership?.displayName ? { displayName: membership.displayName } : {})
        };
      }),
      activityHistory: await listActivityHistoryForAthlete(sub),
      pacingEstimates: (await listPacingEstimatesForAthlete(sub)).map((row) => row.estimate),
      strava: { connected: (await getStravaConnectionPublic(sub)).connected }
    };
    return reply.header("content-disposition", 'attachment; filename="crewcue-account-export.json"').send(body);
  });
}
