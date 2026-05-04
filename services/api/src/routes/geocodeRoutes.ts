import type { FastifyInstance } from "fastify";
import type { GeocodeSearchResultItem } from "@crewcue/contracts";
import { getRaceRoom } from "./raceRooms.js";

type MaptilerFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
  place_name?: string;
};

type MaptilerGeocodeResponse = {
  features?: MaptilerFeature[];
};

function labelFromFeature(f: MaptilerFeature): string {
  const props = f.properties ?? {};
  const formatted =
    typeof props.formatted_address === "string"
      ? props.formatted_address
      : typeof props.label === "string"
        ? props.label
        : typeof props.place === "string"
          ? props.place
          : typeof props.name === "string"
            ? props.name
            : "";
  if (formatted.trim()) {
    return formatted.trim();
  }
  if (typeof f.place_name === "string" && f.place_name.trim()) {
    return f.place_name.trim();
  }
  return "Unknown place";
}

function coordsFromFeature(f: MaptilerFeature): [number, number] | null {
  const g = f.geometry;
  if (!g?.coordinates) {
    return null;
  }
  if (g.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const [lng, lat] = g.coordinates as [number, number];
    if (typeof lng === "number" && typeof lat === "number") {
      return [lng, lat];
    }
  }
  return null;
}

/** Authenticated MapTiler geocode proxy — uses server `MAPTILER_API_KEY` (not client tile keys). */
export async function geocodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/race-rooms/:roomId/geocode/search", async (request, reply) => {
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

    const qRaw = (request.query as { q?: string }).q ?? "";
    const q = qRaw.trim();
    if (q.length < 2) {
      return reply.code(400).send({ error: "Query must be at least 2 characters" });
    }

    const key = process.env.MAPTILER_API_KEY?.trim();
    if (!key) {
      return reply.code(503).send({ error: "Geocoding is not configured (MAPTILER_API_KEY)" });
    }

    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}&limit=10`;

    let data: MaptilerGeocodeResponse;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      data = (await res.json()) as MaptilerGeocodeResponse;
      if (!res.ok) {
        request.log.warn({ status: res.status, body: data }, "maptiler_geocode_http_error");
        return reply.code(502).send({ error: "Geocoding provider error" });
      }
    } catch (err) {
      request.log.error({ err }, "maptiler_geocode_fetch_failed");
      return reply.code(502).send({ error: "Geocoding provider unreachable" });
    }

    const results: GeocodeSearchResultItem[] = [];
    for (const feature of data.features ?? []) {
      const coords = coordsFromFeature(feature);
      if (!coords) {
        continue;
      }
      results.push({
        label: labelFromFeature(feature),
        longitude: coords[0],
        latitude: coords[1]
      });
    }

    return reply.send({ results });
  });
}
