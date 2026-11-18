import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { startTelemetry, stopTelemetry } from "./telemetry.js";
import { validateRoomPersistenceEnv } from "./lib/roomPersistence.js";
import { validateAuthEnv } from "./lib/authEnv.js";
import {
  startChatRetentionScheduler,
  stopChatRetentionScheduler
} from "./lib/chatRetentionScheduler.js";
import { attachTrackingReminderScheduler } from "./lib/trackingReminderScheduler.js";
import { UNPAID_RACE_EXPIRY_ENABLED, createUnpaidRaceExpiryScheduler } from "./lib/unpaidRaceExpiryScheduler.js";
import { createUnpaidRaceReminderScheduler } from "./lib/unpaidRaceReminderScheduler.js";
import {
  listRaceRoomsForRetention,
  listRaceRoomsStartingBetween,
  listUnpaidRaceRoomsCreatedBefore,
  listUnpaidRaceRoomsForReminders
} from "./routes/raceRooms.js";
import { captureError, flushErrorReporting, initErrorReporting, installProcessHandlers } from "./lib/errorReporting.js";

/** Load monorepo-root `.env` when present (Node 20.12+). Does not override existing process.env keys. */
const repoRootEnv = resolve(fileURLToPath(new URL("../../../.env", import.meta.url)));
if (existsSync(repoRootEnv) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(repoRootEnv);
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

initErrorReporting();
installProcessHandlers();

async function start() {
  validateRoomPersistenceEnv();
  validateAuthEnv();
  await startTelemetry();
  const app = buildApp();
  // Tracking reminder pushes: ticks every minute from when the app is ready, stops on app.close().
  attachTrackingReminderScheduler(app, { listRooms: listRaceRoomsStartingBetween });
  // Unpaid races: reminder pushes to the runner every 15 minutes, and a sweeper that deletes a race
  // 30 days old an hour at a time, a day after its last reminder at the soonest. Both start once the
  // server listens and stop on shutdown, with no Fastify hooks (UNPAID_RACE_EXPIRY_ENABLED, R32).
  const unpaidRaceReminders = UNPAID_RACE_EXPIRY_ENABLED
    ? createUnpaidRaceReminderScheduler({ listRooms: listUnpaidRaceRoomsForReminders, log: app.log })
    : undefined;
  const unpaidRaceExpiry = UNPAID_RACE_EXPIRY_ENABLED
    ? createUnpaidRaceExpiryScheduler({ listRooms: listUnpaidRaceRoomsCreatedBefore, log: app.log })
    : undefined;
  await app.listen({ port, host });

  startChatRetentionScheduler(listRaceRoomsForRetention, app.log);
  unpaidRaceReminders?.start();
  unpaidRaceExpiry?.start();

  const shutdown = async () => {
    stopChatRetentionScheduler();
    // Each ends its pass at a room boundary and waits 5 s at most; together, not one after the other.
    await Promise.all([unpaidRaceReminders?.stop(), unpaidRaceExpiry?.stop()]);
    await app.close();
    await stopTelemetry();
    await flushErrorReporting();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(async (error) => {
  console.error(error);
  captureError(error);
  await flushErrorReporting();
  process.exit(1);
});
