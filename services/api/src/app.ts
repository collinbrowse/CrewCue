import Fastify from "fastify";
import { authPlugin } from "./plugins/auth.js";
import { auditPlugin } from "./plugins/audit.js";
import { rateLimitPlugin } from "./plugins/rateLimit.js";
import { logSafeUrl } from "./lib/logSafeUrl.js";
import { registerErrorReporting } from "./lib/errorReporting.js";
import { DEFAULT_BODY_LIMIT_BYTES, registerBodyTooLargeReply } from "./lib/bodyLimits.js";
import { healthRoutes } from "./routes/health.js";
import { analyticsRoutes } from "./routes/analyticsRoutes.js";
import { chatRoutes } from "./routes/chatRoutes.js";
import { routingRoutes } from "./routes/routingRoutes.js";
import { raceRoomRoutes } from "./routes/raceRooms.js";
import { courseGpxRoutes } from "./routes/courseGpxRoutes.js";
import { raceRoomStopPlanRoutes } from "./routes/raceRoomStopPlans.js";
import { raceRoomScheduleRoutes } from "./routes/raceRoomSchedule.js";
import { activityHistoryRoutes } from "./routes/activityHistory.js";
import { stravaRoutes } from "./routes/stravaRoutes.js";
import { pacingEstimateRoutes } from "./routes/pacingEstimates.js";
import { ws4AdaptivePlanRoutes } from "./routes/ws4AdaptivePlanRoutes.js";
import { ws5SyncRoutes } from "./routes/ws5SyncRoutes.js";
import { ws6CommandCenterRoutes } from "./routes/ws6CommandCenterRoutes.js";
import { ws7PlatformRoutes } from "./routes/ws7PlatformRoutes.js";
import { accountRoutes } from "./routes/accountRoutes.js";
import { billingRoutes } from "./routes/billingRoutes.js";

export function buildApp() {
  const app = Fastify({
    logger: {
      // Never log credentials. Request URLs drop their query (OAuth codes, search text).
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-crewcue-billing-admin-secret']"],
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: logSafeUrl(request.url),
            host: request.host,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort
          };
        }
      }
    },
    // Routes that take files (GPX, activity exports, photos) set their own, larger limit.
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES
  });

  registerErrorReporting(app);
  registerBodyTooLargeReply(app);
  app.register(authPlugin);
  app.register(auditPlugin);
  app.register(rateLimitPlugin);
  app.register(healthRoutes);
  app.register(raceRoomRoutes);
  app.register(courseGpxRoutes);
  app.register(raceRoomStopPlanRoutes);
  app.register(raceRoomScheduleRoutes);
  app.register(activityHistoryRoutes);
  app.register(stravaRoutes);
  app.register(pacingEstimateRoutes);
  app.register(routingRoutes);
  app.register(analyticsRoutes);
  app.register(chatRoutes);
  app.register(ws4AdaptivePlanRoutes);
  app.register(ws5SyncRoutes);
  app.register(ws6CommandCenterRoutes);
  app.register(ws7PlatformRoutes);
  app.register(accountRoutes);
  app.register(billingRoutes);

  return app;
}
