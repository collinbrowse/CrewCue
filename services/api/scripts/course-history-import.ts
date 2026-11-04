/**
 * Import course history from a JSON file in the split format (one event or an array). Every event
 * is validated first; a bad file changes nothing. Each event's usage comes from its source and
 * COURSE_HISTORY_PRODUCT_SOURCES (default `crewcue`): other sources are stored backtest_only.
 *
 *   npm run course-history:import -- --file events.json
 *   (PERSISTENCE_MODE=postgres DATABASE_URL=… for the real store)
 */
import { parseArgs } from "node:util";
import { importCourseHistoryFile } from "../src/lib/courseHistory/sources/fileImport.js";
import { importCourseHistoryEvents } from "../src/lib/courseHistory/store.js";
import { initRoomPersistence } from "../src/lib/roomPersistence.js";

const { values } = parseArgs({ options: { file: { type: "string" } } });
if (!values.file) {
  process.stderr.write("usage: course-history:import -- --file <events.json>\n");
  process.exit(1);
}
const log = { info: () => undefined, warn: console.warn, error: console.error } as never;
await initRoomPersistence(log);
try {
  const events = importCourseHistoryFile(values.file);
  const stored = await importCourseHistoryEvents(events);
  for (const row of stored) {
    process.stdout.write(`${row.id}  ${row.usage.padEnd(13)} ${row.event.efforts.length} finishers  ${row.event.name}\n`);
  }
  process.stdout.write(`imported ${stored.length} event(s)\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(`nothing imported: ${(error as Error).message}\n`);
  process.exit(1);
}
