import type { FastifyInstance } from "fastify";
import type { HealthStatus } from "@crewcue/contracts";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", async (): Promise<HealthStatus> => ({
    service: "api",
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  app.get("/health/ready", async (): Promise<HealthStatus> => ({
    service: "api",
    status: "ok",
    timestamp: new Date().toISOString()
  }));
}
