import Fastify from "fastify";
import { authPlugin } from "./plugins/auth.js";
import { auditPlugin } from "./plugins/audit.js";
import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  app.register(authPlugin);
  app.register(auditPlugin);
  app.register(healthRoutes);
  app.register(eventRoutes);

  return app;
}
