import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { logSafeUrl } from "../lib/logSafeUrl.js";

interface AuditEntry {
  at: string;
  method: string;
  path: string;
  actor: string;
  statusCode: number;
  requestId: string;
}

function getActor(request: FastifyRequest): string {
  return request.identity?.sub ?? "anonymous";
}

export const auditPlugin = fp(async (app) => {
  app.addHook("onResponse", async (request, reply) => {
    const entry: AuditEntry = {
      at: new Date().toISOString(),
      method: request.method,
      path: logSafeUrl(request.url),
      actor: getActor(request),
      statusCode: reply.statusCode,
      requestId: request.id
    };

    app.log.info({ audit: entry }, "audit_log");
  });
});
