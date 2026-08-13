import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory containing this helper and the shared pacing fixture pack. */
export const PACING_FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Required pack files from `docs/sdlc/agent-async-delivery-program.md` §5.
 * Paths are unique; do not add a second golden for the same id.
 */
export const PACING_FIXTURE_FILES = [
  "course-50k-with-aids.gpx",
  "activity-long-trail.gpx",
  "activity-short-road.gpx",
  "corrupt.gpx",
  "empty.gpx",
  "schedule-expected.json",
  "estimate-cold-start.json",
  "estimate-bands.json",
  "cutoff-compare.json",
  "strava-activity-summary.json"
] as const;

export type PacingFixtureFile = (typeof PACING_FIXTURE_FILES)[number];

export type GpxInspectKind = "track" | "empty" | "corrupt";

export interface GpxInspectResult {
  kind: GpxInspectKind;
  trackPointCount: number;
  waypointCount: number;
  reason?: string;
}

const TRKPT_RE = /<(?:[\w-]+:)?(?:trkpt|rtept)\b/gi;
const WPT_RE = /<(?:[\w-]+:)?wpt\b/gi;

export function pacingFixturePath(fileName: PacingFixtureFile | string): string {
  return join(PACING_FIXTURES_DIR, fileName);
}

export function assertPacingFixturesPresent(): string[] {
  const missing = PACING_FIXTURE_FILES.filter((fileName) => !existsSync(pacingFixturePath(fileName)));
  if (missing.length > 0) {
    throw new Error(`Missing required pacing fixtures: ${missing.join(", ")}`);
  }
  return [...PACING_FIXTURE_FILES];
}

export function readPacingFixture(fileName: PacingFixtureFile | string): string {
  return readFileSync(pacingFixturePath(fileName), "utf8");
}

export function readPacingFixtureJson(fileName: PacingFixtureFile | string): unknown {
  return JSON.parse(readPacingFixture(fileName));
}

/**
 * Classify a GPX document without throwing (test harness must stay up for empty/corrupt files).
 * Empty: well-formed `<gpx>` with no track/route points. Corrupt: missing root or truncated markup.
 */
export function inspectGpx(xml: string): GpxInspectResult {
  const trimmed = xml.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return { kind: "corrupt", trackPointCount: 0, waypointCount: 0, reason: "empty-file" };
  }
  const hasRoot = /<gpx[\s>]/i.test(trimmed);
  const closed = /<\/gpx>/i.test(trimmed);
  const truncatedTag = /<(?:[\w-]+:)?(?:trkpt|rtept|wpt|trk|name)\b[^>]*$/im.test(trimmed);
  if (!hasRoot || !closed || truncatedTag) {
    return {
      kind: "corrupt",
      trackPointCount: 0,
      waypointCount: 0,
      reason: !hasRoot ? "missing-gpx-root" : truncatedTag ? "truncated-markup" : "unclosed-gpx"
    };
  }
  const trackPointCount = trimmed.match(TRKPT_RE)?.length ?? 0;
  const waypointCount = trimmed.match(WPT_RE)?.length ?? 0;
  if (trackPointCount === 0) {
    return { kind: "empty", trackPointCount: 0, waypointCount };
  }
  return { kind: "track", trackPointCount, waypointCount };
}
