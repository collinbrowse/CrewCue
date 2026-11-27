import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_GPX_XML_CHARS } from "../lib/gpxLimits.js";
import { GPX_FILE_TOO_LARGE, GPX_JSON_BODY_LIMIT_BYTES, largeBodyRoute } from "../lib/bodyLimits.js";
import { parseUploadInWorker, UploadParseLimitError } from "../lib/uploadParse.js";
import { getRaceRoom } from "./raceRooms.js";

export { coursePreviewFromGpx } from "../lib/coursePreview.js";

const gpxPreviewInput = z.object({
  gpxXml: z.string().min(1).max(MAX_GPX_XML_CHARS),
  courseFileName: z.string().trim().min(1).max(500)
});

export async function courseGpxRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/race-rooms/:roomId/course/gpx-preview",
    largeBodyRoute(GPX_JSON_BODY_LIMIT_BYTES, GPX_FILE_TOO_LARGE),
    async (request, reply) => {
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
        return reply.send(
          await parseUploadInWorker({
            kind: "coursePreview",
            gpxXml: parsed.data.gpxXml,
            courseFileName: parsed.data.courseFileName
          })
        );
      } catch (error) {
        if (error instanceof UploadParseLimitError) {
          return reply.code(422).send({ error: error.message, code: error.code });
        }
        const message = error instanceof Error ? error.message : "Couldn't read the route file.";
        return reply.code(400).send({ error: message });
      }
    }
  );
}
