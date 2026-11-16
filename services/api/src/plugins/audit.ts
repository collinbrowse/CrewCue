import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
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
  const sub = request.identity?.sub;
  if (!sub) return "anonymous";
  // Account deletion (#560): the subject is gone afterwards, so its audit line keeps only a hash.
  if (request.method === "DELETE" && request.routeOptions.url === "/me") {
    return `sha256:${createHash("sha256").update(sub, "utf8").digest("hex").slice(0, 16)}`;
  }
  return sub;
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
