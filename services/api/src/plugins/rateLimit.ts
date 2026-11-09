import fp from "fastify-plugin";

interface Limit {
  max: number;
  windowMs: number;
  /** Also cap each client IP, so new accounts cannot reset the budget. */
  perIpMax?: number;
}

const MINUTE = 60_000;

/** Routes that spend provider quota or CPU. Keyed by route pattern, not URL. */
export const RATE_LIMITED_ROUTES: Readonly<Record<string, Limit>> = {
  "/race-rooms/:roomId/geocode/search": { max: 30, windowMs: MINUTE },
  "/race-rooms/:roomId/routing/route": { max: 30, windowMs: MINUTE },
  "/race-rooms/:roomId/course/gpx-preview": { max: 10, windowMs: MINUTE },
  "/activity-history/gpx": { max: 10, windowMs: MINUTE },
  "/activity-history/file": { max: 10, windowMs: MINUTE },
  "/race-rooms/join-by-code": { max: 10, windowMs: MINUTE, perIpMax: 30 }
};

/** Fixed-window, in-process limiter per signed-in user (client IP when unauthenticated). */
export const rateLimitPlugin = fp(async (app) => {
  const windows = new Map<string, { resetAt: number; count: number }>();

  app.addHook("preHandler", async (request, reply) => {
    const limit = RATE_LIMITED_ROUTES[request.routeOptions.url ?? ""];
    if (!limit) {
      return;
    }
    const now = Date.now();
    if (windows.size > 10_000) {
      for (const [key, w] of windows) {
        if (w.resetAt <= now) windows.delete(key);
      }
    }
    const route = request.routeOptions.url;
    const buckets: Array<{ key: string; max: number }> = [
      { key: `${route}|${request.identity?.sub ?? request.ip}`, max: limit.max }
    ];
    if (limit.perIpMax !== undefined) {
      buckets.push({ key: `${route}|ip|${request.ip}`, max: limit.perIpMax });
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
        return reply.code(429).send({ error: "Too many requests" });
      }
    }
  });
});
