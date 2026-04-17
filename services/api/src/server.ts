import { buildApp } from "./app.js";
import { startTelemetry, stopTelemetry } from "./telemetry.js";
import { validateRoomPersistenceEnv } from "./lib/roomPersistence.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function start() {
  validateRoomPersistenceEnv();
  await startTelemetry();
  const app = buildApp();
  await app.listen({ port, host });

  const shutdown = async () => {
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
