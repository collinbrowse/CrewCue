import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DomainEvent } from "@crewcue/contracts";

const eventInput = z.object({
  aggregateId: z.string().min(1),
  aggregateType: z.string().min(1),
  eventType: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.unknown()
});

const events: DomainEvent[] = [];

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/events", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = eventInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid event payload" });
    }

    const duplicate = events.find((e) => e.idempotencyKey === parsed.data.idempotencyKey);
    if (duplicate) {
      return reply.code(200).send(duplicate);
    }

    const next: DomainEvent = {
      id: randomUUID(),
      aggregateId: parsed.data.aggregateId,
      aggregateType: parsed.data.aggregateType,
      eventType: parsed.data.eventType,
      occurredAt: new Date().toISOString(),
      version: 1,
      idempotencyKey: parsed.data.idempotencyKey,
      payload: parsed.data.payload
    };

    events.push(next);
    return reply.code(202).send(next);
  });
}
