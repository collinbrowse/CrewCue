import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NavigationRouteResult, NavigationRouteStep } from "@crewcue/contracts";
import { getRaceRoom } from "./raceRooms.js";

const postRoomRouteInput = z.object({
  mode: z.enum(["drive", "hike"]),
  coordinates: z
    .array(
      z.object({
        longitude: z.number().gte(-180).lte(180),
        latitude: z.number().gte(-90).lte(90)
      })
    )
    .min(2)
    .max(25)
});

type OsrmRouteResponse = {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: Array<{
      steps?: Array<{
        maneuver?: { instruction?: string };
        distance?: number;
        duration?: number;
      }>;
    }>;
  }>;
  code?: string;
};

function osrmProfileForMode(mode: "drive" | "hike"): "driving" | "walking" {
  return mode === "drive" ? "driving" : "walking";
}

function buildCoordinatePath(
  coordinates: Array<{ longitude: number; latitude: number }>
): string {
  return coordinates.map((c) => `${c.longitude},${c.latitude}`).join(";");
}

function summarizeOsrmRoute(data: OsrmRouteResponse): NavigationRouteResult | null {
  const route = data.routes?.[0];
  if (!route || !route.geometry?.coordinates || route.geometry.coordinates.length < 2) {
    return null;
  }
  const steps: NavigationRouteStep[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      steps.push({
        instruction: step.maneuver?.instruction?.trim() || "Continue",
        distanceMeters: step.distance ?? 0,
        durationSeconds: step.duration ?? 0
      });
    }
  }
  return {
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
    geometry: {
      type: "LineString",
      coordinates: route.geometry.coordinates
    },
    steps
  };
}

/**
 * OSRM proxy: set `OSRM_ROUTER_BASE_URL` to a contractually allowed router in production.
 * Default uses the public Project OSRM demo (not for production load).
 */
export async function routingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/race-rooms/:roomId/routing/route", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const parsed = postRoomRouteInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid routing payload" });
    }

    const baseUrl =
      process.env.OSRM_ROUTER_BASE_URL?.replace(/\/$/, "") ?? "https://router.project-osrm.org";
    const profile = osrmProfileForMode(parsed.data.mode);
    const coordPath = buildCoordinatePath(parsed.data.coordinates);
    const url = `${baseUrl}/route/v1/${profile}/${coordPath}?overview=full&steps=true&geometries=geojson`;

    let osrmJson: OsrmRouteResponse;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      osrmJson = (await res.json()) as OsrmRouteResponse;
      if (!res.ok) {
        return reply.code(502).send({ error: "Routing provider error", detail: osrmJson });
      }
    } catch (err) {
      request.log.error({ err }, "routing_fetch_failed");
      return reply.code(502).send({ error: "Routing provider unreachable" });
    }

    if (osrmJson.code && osrmJson.code !== "Ok") {
      return reply.code(404).send({
        error:
          parsed.data.mode === "hike"
            ? "Trail-connected walking directions are not available for this path in this area."
            : "Driving directions are not available for this path.",
        code: osrmJson.code
      });
    }

    const summary = summarizeOsrmRoute(osrmJson);
    if (!summary) {
      return reply.code(404).send({
        error:
          parsed.data.mode === "hike"
            ? "Trail-connected walking directions are not available for this destination in this area."
            : "Driving directions are not available for this destination.",
        partial: false
      });
    }

    return reply.send({ route: summary });
  });
}
