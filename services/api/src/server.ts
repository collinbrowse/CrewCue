import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { startTelemetry, stopTelemetry } from "./telemetry.js";
import { validateRoomPersistenceEnv } from "./lib/roomPersistence.js";
import {
  startChatRetentionScheduler,
  stopChatRetentionScheduler
} from "./lib/chatRetentionScheduler.js";
import { listRaceRoomsForRetention } from "./routes/raceRooms.js";

/** Load monorepo-root `.env` when present (Node 20.12+). Does not override existing process.env keys. */
const repoRootEnv = resolve(fileURLToPath(new URL("../../../.env", import.meta.url)));
if (existsSync(repoRootEnv) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(repoRootEnv);
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function start() {
  validateRoomPersistenceEnv();
  await startTelemetry();
  const app = buildApp();
  await app.listen({ port, host });

  startChatRetentionScheduler(listRaceRoomsForRetention, app.log);

  const shutdown = async () => {
    stopChatRetentionScheduler();
    await app.close();
    await stopTelemetry();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
