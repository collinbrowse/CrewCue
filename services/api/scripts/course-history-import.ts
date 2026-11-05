/**
 * Import course history. Every event is validated first; a bad input changes nothing. Each event's
 * usage comes from its source and COURSE_HISTORY_PRODUCT_SOURCES (default `crewcue,opensplittime`):
 * other sources are stored backtest_only.
 *
 *   npm run course-history:import -- --file events.json
 *   npm run course-history:import -- --opensplittime hardrock-100-2024 hardrock-100-2023
 *   npm run course-history:import -- --opensplittime hardrock-100-2024 --out hardrock.json   (file only, no store)
 *   (PERSISTENCE_MODE=postgres DATABASE_URL=… for the real store)
 *
 * OpenSplitTime events are read from its public results pages, one per second (permission
 * granted Nov 2026; estimates that use them credit OpenSplitTime.org).
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { CourseHistoryEvent } from "../src/lib/courseHistory/format.js";
import { importCourseHistoryFile } from "../src/lib/courseHistory/sources/fileImport.js";
import { fetchOpenSplitTimeEvents } from "../src/lib/courseHistory/sources/openSplitTime.js";
import { importCourseHistoryEvents } from "../src/lib/courseHistory/store.js";
import { initRoomPersistence } from "../src/lib/roomPersistence.js";

const { values, positionals } = parseArgs({
  options: { file: { type: "string" }, opensplittime: { type: "boolean" }, out: { type: "string" } },
  allowPositionals: true
});
if (!values.file && !(values.opensplittime && positionals.length > 0)) {
  process.stderr.write(
    "usage: course-history:import -- --file <events.json>\n" +
      "       course-history:import -- --opensplittime <event-slug…> [--out <events.json>]\n"
  );
  process.exit(1);
}
try {
  const events: CourseHistoryEvent[] = values.file
    ? importCourseHistoryFile(values.file)
    : await fetchOpenSplitTimeEvents(positionals);
  if (values.out) {
    writeFileSync(values.out, `${JSON.stringify(events, null, 2)}\n`);
    for (const e of events) process.stdout.write(`${e.source}:${e.sourceEventId}  ${e.efforts.length} finishers  ${e.name}\n`);
    process.stdout.write(`wrote ${events.length} event(s) to ${values.out}; nothing stored\n`);
    process.exit(0);
  }
  const log = { info: () => undefined, warn: console.warn, error: console.error } as never;
  await initRoomPersistence(log);
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
