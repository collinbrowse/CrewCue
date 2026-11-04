/**
 * File import: a JSON file already in the split format (one event, or an array of events).
 * Any permitted export can be loaded this way without new code.
 */
import { readFileSync } from "node:fs";
import { validateCourseHistoryEvent, type CourseHistoryEvent } from "../format.js";

export class CourseHistoryImportError extends Error {
  constructor(
    readonly label: string,
    readonly errors: string[]
  ) {
    super(`${label}: ${errors.length} problem(s): ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "; …" : ""}`);
    this.name = "CourseHistoryImportError";
  }
}

/** Parse and validate JSON text. Throws {@link CourseHistoryImportError} on bad JSON or any invalid event. */
export function parseCourseHistoryJson(text: string, label = "input"): CourseHistoryEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CourseHistoryImportError(label, [`not valid JSON (${(error as Error).message})`]);
  }
  const items = Array.isArray(raw) ? raw : [raw];
  const events: CourseHistoryEvent[] = [];
  const errors: string[] = [];
  items.forEach((item, index) => {
    const result = validateCourseHistoryEvent(item);
    if (result.ok) {
      events.push(result.event);
    } else {
      const prefix = Array.isArray(raw) ? `[${index}] ` : "";
      errors.push(...result.errors.map((e) => prefix + e));
    }
  });
  if (errors.length > 0) {
    throw new CourseHistoryImportError(label, errors);
  }
  return events;
}

export function importCourseHistoryFile(path: string): CourseHistoryEvent[] {
  return parseCourseHistoryJson(readFileSync(path, "utf8"), path);
}
