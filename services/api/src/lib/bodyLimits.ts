import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MAX_GPX_XML_CHARS } from "./gpxLimits.js";

/** Every route's request body limit unless the route sets its own (below). */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

/** Room for the JSON around a large string field (other fields, keys, quotes). */
const JSON_ENVELOPE_BYTES = 64 * 1024;

/**
 * A JSON body carrying one `gpxXml` of up to `MAX_GPX_XML_CHARS`. JSON escaping (quotes,
 * newlines) and multi-byte names can grow the string, so allow twice its character cap.
 */
export const GPX_JSON_BODY_LIMIT_BYTES = 2 * MAX_GPX_XML_CHARS + JSON_ENVELOPE_BYTES;

/**
 * `PUT /race-rooms/:roomId/course`: the server's GPX preview (checkpoints, baseline track, route
 * line) plus the raw `courseGpxXml`.
 */
export const COURSE_BODY_LIMIT_BYTES = GPX_JSON_BODY_LIMIT_BYTES + 4 * 1024 * 1024;

/** `PUT /race-rooms/:roomId/map-workspace`: up to 24 layers of route lines plus checkpoints. */
export const MAP_WORKSPACE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

/** A JSON body carrying one base64 string of up to `base64Chars` characters. */
export function base64JsonBodyLimitBytes(base64Chars: number): number {
  return base64Chars + JSON_ENVELOPE_BYTES;
}

/** What a route answers (413) when its body is over its limit. Defaults to `BODY_TOO_LARGE`. */
export type BodyTooLargeReply = { error: string; code: string };

export const BODY_TOO_LARGE: BodyTooLargeReply = { error: "Request body is too large", code: "body_too_large" };

/** Over-limit body on a GPX route. */
export const GPX_FILE_TOO_LARGE: BodyTooLargeReply = {
  error: "The route file is larger than 10 MB.",
  code: "file_too_large"
};

declare module "fastify" {
  interface FastifyContextConfig {
    bodyTooLarge?: BodyTooLargeReply;
  }
}

/**
 * Route `onRequest` hook for routes that take large bodies: answers 401 before the body is read.
 * Needs the auth plugin's `onRequest` hook to have run (it is registered first).
 */
export async function requireIdentityBeforeBody(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.identity) {
    await reply.code(401).send({ error: "Unauthorized" });
  }
}

/**
 * Options for a route with its own body limit: the limit, the 401-before-body hook, and the 413
 * body. Spread into the route options.
 */
export function largeBodyRoute(bodyLimit: number, bodyTooLarge: BodyTooLargeReply = BODY_TOO_LARGE) {
  return {
    bodyLimit,
    onRequest: requireIdentityBeforeBody,
    config: { bodyTooLarge }
  };
}

/** Answers an over-limit body with `{ error, code }` (the route's `bodyTooLarge`, else the default). */
export function registerBodyTooLargeReply(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send(request.routeOptions.config?.bodyTooLarge ?? BODY_TOO_LARGE);
    }
    // Everything else keeps Fastify's default handling.
    throw error;
  });
}
