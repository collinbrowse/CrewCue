/**
 * Shared test helpers for the evaluation harness (fixture lookup works from src/ and dist/).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 14; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "course-50k-with-aids.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing/course-50k-with-aids.gpx not found");
}

export function evaluationCorpusDir(): string {
  return resolve(findPacingFixturesDir(), "eval");
}
