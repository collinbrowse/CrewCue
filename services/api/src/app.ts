import Fastify from "fastify";
import { authPlugin } from "./plugins/auth.js";
import { auditPlugin } from "./plugins/audit.js";
import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";
import { raceRoomRoutes } from "./routes/raceRooms.js";
import { ws4AdaptivePlanRoutes } from "./routes/ws4AdaptivePlanRoutes.js";
import { ws5SyncRoutes } from "./routes/ws5SyncRoutes.js";
import { ws6CommandCenterRoutes } from "./routes/ws6CommandCenterRoutes.js";

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  app.register(authPlugin);
  app.register(auditPlugin);
  app.register(healthRoutes);
  app.register(eventRoutes);
  app.register(raceRoomRoutes);
  app.register(ws4AdaptivePlanRoutes);
  app.register(ws5SyncRoutes);
  app.register(ws6CommandCenterRoutes);

  return app;
}
