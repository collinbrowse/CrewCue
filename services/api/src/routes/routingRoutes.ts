import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  NavigationRouteMeta,
  NavigationRouteResult,
  NavigationRouteStep,
  RaceCourseCheckpoint,
  RaceRoom
} from "@crewcue/contracts";
import { getRaceRoom } from "./raceRooms.js";

const lonLat = z.object({
  longitude: z.number().gte(-180).lte(180),
  latitude: z.number().gte(-90).lte(90)
});

const postRoomRouteInput = z
  .object({
    mode: z.enum(["drive", "hike"]),
    coordinates: z.array(lonLat).min(2).max(25).optional(),
    checkpointIds: z.array(z.string().min(1)).min(2).max(25).optional()
  })
  .superRefine((val, ctx) => {
    const hasCoords = val.coordinates !== undefined && val.coordinates.length >= 2;
    const hasCp = val.checkpointIds !== undefined && val.checkpointIds.length >= 2;
    if (!hasCoords && !hasCp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide coordinates (2+) or checkpointIds (2+)"
      });
    }
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

function workspaceCheckpoints(room: RaceRoom): RaceCourseCheckpoint[] {
  const mw = room.mapWorkspace?.checkpoints;
  if (mw && mw.length > 0) {
    return mw;
  }
  return room.course?.checkpoints ?? [];
}

function coordsFromCheckpointIds(room: RaceRoom, ids: string[]): Array<{ longitude: number; latitude: number }> | null {
  const list = workspaceCheckpoints(room);
  const map = new Map(list.map((c) => [c.id, c]));
  const out: Array<{ longitude: number; latitude: number }> = [];
  for (const id of ids) {
    const c = map.get(id);
    if (!c) {
      return null;
    }
    out.push({ longitude: c.longitude, latitude: c.latitude });
  }
  return out;
}

function resolveRoutingCoordinates(
  room: RaceRoom,
  body: z.infer<typeof postRoomRouteInput>
): Array<{ longitude: number; latitude: number }> | null {
  if (body.checkpointIds && body.checkpointIds.length >= 2) {
    return coordsFromCheckpointIds(room, body.checkpointIds);
  }
  if (body.coordinates && body.coordinates.length >= 2) {
    return body.coordinates;
  }
  return null;
}

function osrmProfileForMode(mode: "drive" | "hike"): "driving" | "walking" {
  return mode === "drive" ? "driving" : "walking";
}

function buildCoordinatePath(coordinates: Array<{ longitude: number; latitude: number }>): string {
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

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function crowFlightBetweenEndpointsMeters(coords: Array<{ longitude: number; latitude: number }>): number {
  if (coords.length < 2) {
    return 0;
  }
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  return haversineMeters(
    { latitude: first.latitude, longitude: first.longitude },
    { latitude: last.latitude, longitude: last.longitude }
  );
}

function buildRouteMeta(mode: "drive" | "hike", summary: NavigationRouteResult, coords: Array<{ longitude: number; latitude: number }>): NavigationRouteMeta {
  const crow = crowFlightBetweenEndpointsMeters(coords);
  const detourRatio = crow > 1 ? summary.distanceMeters / crow : 1;
  const meta: NavigationRouteMeta = {
    detourRatio: Math.round(detourRatio * 100) / 100
  };
  if (mode === "hike" && detourRatio > 2.25) {
    meta.hikeRouteQuality = "possibly_indirect";
  } else if (mode === "hike") {
    meta.hikeRouteQuality = "direct";
  }
  return meta;
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

    const coords = resolveRoutingCoordinates(room, parsed.data);
    if (!coords) {
      return reply.code(400).send({
        error:
          parsed.data.checkpointIds !== undefined
            ? "One or more checkpoint IDs were not found in this race room workspace."
            : "Unable to resolve routing coordinates."
      });
    }

    const baseUrl =
      process.env.OSRM_ROUTER_BASE_URL?.replace(/\/$/, "") ?? "https://router.project-osrm.org";
    const profile = osrmProfileForMode(parsed.data.mode);
    const coordPath = buildCoordinatePath(coords);
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

    const meta = buildRouteMeta(parsed.data.mode, summary, coords);
    return reply.send({ route: summary, meta });
  });
}
