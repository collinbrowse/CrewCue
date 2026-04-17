import type { FastifyInstance } from "fastify";
import type { HealthStatus } from "@crewcue/contracts";
import { getRoomPersistenceMode, isRoomPersistenceEnabled } from "../lib/roomPersistence.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", async (): Promise<HealthStatus & { persistence: { mode: string; enabled: boolean } }> => ({
    service: "api",
    status: "ok",
    timestamp: new Date().toISOString(),
    persistence: {
      mode: getRoomPersistenceMode(),
      enabled: isRoomPersistenceEnabled()
    }
  }));

  app.get("/health/ready", async (): Promise<HealthStatus & { persistence: { mode: string; enabled: boolean } }> => ({
    service: "api",
    status: "ok",
    timestamp: new Date().toISOString(),
    persistence: {
      mode: getRoomPersistenceMode(),
      enabled: isRoomPersistenceEnabled()
    }
  }));
}
