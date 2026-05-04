import type { FastifyInstance } from "fastify";
import { z } from "zod";

const analyticsEventInput = z.object({
  name: z.string().min(1).max(120),
  properties: z.record(z.string(), z.any()).optional(),
  occurredAt: z.iso.datetime().optional()
});

const postAnalyticsBatchInput = z.object({
  events: z.array(analyticsEventInput).min(1).max(100)
});

/** Minimal authenticated analytics ingest for navigation/offline/map instrumentation. */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/analytics/v1/events", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = postAnalyticsBatchInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid analytics payload" });
    }

    request.log.info(
      {
        analytics: {
          userId: request.identity.sub,
          count: parsed.data.events.length,
          names: parsed.data.events.map((e) => e.name)
        }
      },
      "analytics_batch_received"
    );

    return reply.code(202).send({ accepted: parsed.data.events.length });
  });
}
