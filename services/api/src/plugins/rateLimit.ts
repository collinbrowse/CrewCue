import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

interface Limit {
  max: number;
  windowMs: number;
  /** Also cap each client IP, so new accounts cannot reset the budget. */
  perIpMax?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Routes that spend provider quota or CPU. Keyed by route pattern, not URL. */
export const RATE_LIMITED_ROUTES: Readonly<Record<string, Limit>> = {
  "/race-rooms/:roomId/routing/route": { max: 30, windowMs: MINUTE },
  "/race-rooms/:roomId/course/gpx-preview": { max: 10, windowMs: MINUTE },
  "/activity-history/gpx": { max: 10, windowMs: MINUTE },
  "/activity-history/file": { max: 10, windowMs: MINUTE },
  "/race-rooms/join-by-code": { max: 10, windowMs: MINUTE, perIpMax: 30 },
  "/me": { max: 5, windowMs: MINUTE },
  "/me/export": { max: 5, windowMs: MINUTE },
  // Each estimate runs the micro-model, and an unpaid race can compute and attach them before
  // paying. One route method each (POST and PUT), so the pattern alone names it.
  "/pacing-estimates": { max: 20, windowMs: HOUR },
  "/race-rooms/:roomId/pacing-estimate": { max: 20, windowMs: HOUR }
};

/**
 * Limits a handler applies itself, when the route pattern alone cannot say whether a request
 * counts. Same counters and 429 as the route limits; see `enforceRateLimit`.
 */
export const CONDITIONAL_RATE_LIMITS = {
  /**
   * `PUT /race-rooms/:roomId/course` on an unpaid race, per user across all their races. Every
   * save recomputes the course and its projection, and the runner can save before paying. Paid
   * course saves are not limited.
   */
  unpaidCourseSave: { max: 10, windowMs: HOUR }
} as const satisfies Record<string, Limit>;

export type ConditionalRateLimit = keyof typeof CONDITIONAL_RATE_LIMITS;

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Counts this request against a `CONDITIONAL_RATE_LIMITS` budget for the signed-in user
     * (client IP when unauthenticated). Past the limit it sends 429 with `retry-after`, as the
     * route limits do, and returns false; the handler must then return.
     */
    enforceRateLimit(request: FastifyRequest, reply: FastifyReply, name: ConditionalRateLimit): Promise<boolean>;
  }
}

/** Fixed-window, in-process limiter per signed-in user (client IP when unauthenticated). */
export const rateLimitPlugin = fp(async (app) => {
  const windows = new Map<string, { resetAt: number; count: number }>();

  /** Counts one request in each bucket; sends 429 and returns false when one is over its max. */
  const consume = async (
    request: FastifyRequest,
    reply: FastifyReply,
    name: string,
    limit: Limit
  ): Promise<boolean> => {
    const now = Date.now();
    if (windows.size > 10_000) {
      for (const [key, w] of windows) {
        if (w.resetAt <= now) windows.delete(key);
      }
    }
    const buckets: Array<{ key: string; max: number }> = [
      { key: `${name}|${request.identity?.sub ?? request.ip}`, max: limit.max }
    ];
    if (limit.perIpMax !== undefined) {
      buckets.push({ key: `${name}|ip|${request.ip}`, max: limit.perIpMax });
    }
    for (const bucket of buckets) {
      let w = windows.get(bucket.key);
      if (!w || w.resetAt <= now) {
        w = { resetAt: now + limit.windowMs, count: 0 };
        windows.set(bucket.key, w);
      }
      w.count += 1;
      if (w.count > bucket.max) {
        reply.header("retry-after", String(Math.max(1, Math.ceil((w.resetAt - now) / 1000))));
        await reply.code(429).send({ error: "Too many requests" });
        return false;
      }
    }
    return true;
  };

  app.decorate("enforceRateLimit", async (request: FastifyRequest, reply: FastifyReply, name: ConditionalRateLimit) =>
    consume(request, reply, `conditional|${name}`, CONDITIONAL_RATE_LIMITS[name])
  );

  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    const limit = RATE_LIMITED_ROUTES[route ?? ""];
    if (!limit || route === undefined) {
      return;
    }
    if (!(await consume(request, reply, route, limit))) {
      return reply;
    }
  });
});
