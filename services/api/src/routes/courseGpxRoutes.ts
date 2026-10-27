import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildRaceCourseFromGpx, parseGpxTrack, parsedTrackToWorkspaceLayer } from "@crewcue/map-core";
import { getRaceRoom } from "./raceRooms.js";

const gpxPreviewInput = z.object({
  gpxXml: z.string().min(1),
  courseFileName: z.string().trim().min(1)
});

/** Server-side GPX parse. Clients upload the file; they do not reimplement course geometry. */
export function coursePreviewFromGpx(gpxXml: string, courseFileName: string) {
  const parsed = parseGpxTrack(gpxXml);
  const built = buildRaceCourseFromGpx(parsed);
  return {
    course: built.course,
    plannedPaceSecondsPerKm: built.plannedPaceSecondsPerKm,
    routeOverlayLayer: parsedTrackToWorkspaceLayer(courseFileName, parsed),
    courseFileName
  };
}

export async function courseGpxRoutes(app: FastifyInstance): Promise<void> {
  app.post("/race-rooms/:roomId/course/gpx-preview", async (request, reply) => {
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
    const parsed = gpxPreviewInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid GPX payload" });
    }
    try {
      return reply.send(coursePreviewFromGpx(parsed.data.gpxXml, parsed.data.courseFileName));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't read the route file.";
      return reply.code(400).send({ error: message });
    }
  });
}
