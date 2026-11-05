/**
 * Link a room's course to past events by hand (or clear the link, back to auto-link). Refuses an
 * event whose checkpoints cover under 80% of the room's aid checkpoints.
 *
 *   npm run course-history:link -- <roomId> <eventId> [<eventId>…]
 *   npm run course-history:link -- <roomId> --clear
 */
import { aidCoverage, LINK_MIN_AID_COVERAGE, mapCheckpoints } from "../src/lib/courseHistory/link.js";
import { getCourseHistoryEvents } from "../src/lib/courseHistory/store.js";
import { initRoomPersistence } from "../src/lib/roomPersistence.js";
import { commitRaceRoomUpdate, getRaceRoom } from "../src/routes/raceRooms.js";

const [roomId, ...rest] = process.argv.slice(2);
if (!roomId || rest.length === 0) {
  process.stderr.write("usage: course-history:link -- <roomId> <eventId…> | --clear\n");
  process.exit(1);
}
const log = { info: () => undefined, warn: console.warn, error: console.error } as never;
await initRoomPersistence(log);
const room = await getRaceRoom(roomId);
if (!room?.course) {
  process.stderr.write(`room ${roomId} not found or has no course\n`);
  process.exit(1);
}
if (rest[0] === "--clear") {
  await commitRaceRoomUpdate(roomId, (latest) => {
    const { courseHistoryEventIds: _drop, ...next } = latest;
    return next;
  });
  process.stdout.write(`cleared; ${roomId} auto-links again\n`);
  process.exit(0);
}
const events = await getCourseHistoryEvents(rest);
const missing = rest.filter((id) => !events.some((e) => e.id === id));
if (missing.length > 0) {
  process.stderr.write(`unknown event(s): ${missing.join(", ")}\n`);
  process.exit(1);
}
for (const stored of events) {
  const coverage = aidCoverage(room.course, mapCheckpoints(room.course, stored.event));
  process.stdout.write(`${stored.id}  ${stored.usage}  aid coverage ${(coverage * 100).toFixed(0)}%\n`);
  if (coverage < LINK_MIN_AID_COVERAGE) {
    process.stderr.write(`refused: ${stored.id} maps under 80% of the room's aid checkpoints\n`);
    process.exit(1);
  }
}
await commitRaceRoomUpdate(roomId, (latest) => ({ ...latest, courseHistoryEventIds: rest }));
process.stdout.write(`linked ${roomId} → ${rest.join(", ")}\n`);
process.exit(0);
