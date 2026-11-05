/**
 * Linking a room's course to past events (plan PR 4).
 *
 * Checkpoints map by position (within 300 m) when the event has coordinates, otherwise by name,
 * otherwise by share of the course (within 2%). A link needs at least 80% of the room's aid-tagged
 * checkpoints mapped (all mid-course checkpoints when none are tagged).
 *
 * Auto-link: events whose start and finish are within 500 m of the room's and whose length is
 * within 5%. Several years of the same race all match; they link together only when they share one
 * checkpoint layout. Matches with different layouts are ambiguous, and nothing is linked (an
 * operator links by hand with `npm run course-history:link`).
 */
import type { RaceCourse, RaceCourseCheckpoint } from "@crewcue/contracts";
import { geodesicDistanceMeters } from "@crewcue/map-core";
import type { CourseHistoryEvent } from "./format.js";
import type { StoredCourseHistoryEvent } from "./store.js";

export const LINK_POSITION_METERS = 300;
export const LINK_SHARE_TOLERANCE = 0.02;
export const LINK_MIN_AID_COVERAGE = 0.8;
export const AUTO_LINK_ENDPOINT_METERS = 500;
export const AUTO_LINK_LENGTH_TOLERANCE = 0.05;

const normalize = (name: string | undefined) => (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function roomLength(course: RaceCourse): number {
  return course.derivedMetrics?.canonicalDistanceMeters ??
    Math.max(0, ...course.checkpoints.map((cp) => cp.distanceMetersFromStart ?? 0));
}

/** Room checkpoint id → event checkpoint id, for every room checkpoint that maps. */
export function mapCheckpoints(course: RaceCourse, event: CourseHistoryEvent): Map<string, string> {
  const out = new Map<string, string>();
  const eventLength = event.checkpoints[event.checkpoints.length - 1]!.distanceMeters;
  const length = roomLength(course);
  const used = new Set<string>();
  course.checkpoints.forEach((cp, index) => {
    const candidates = event.checkpoints.filter((e) => !used.has(e.id));
    let match: string | undefined;
    // Start and finish map to start and finish.
    if (index === 0) match = event.checkpoints[0]!.id;
    else if (index === course.checkpoints.length - 1) match = event.checkpoints[event.checkpoints.length - 1]!.id;
    if (!match) {
      const located = candidates
        .filter((e) => e.latitude !== undefined && e.longitude !== undefined)
        .map((e) => ({ id: e.id, d: geodesicDistanceMeters({ latitude: cp.latitude, longitude: cp.longitude }, { latitude: e.latitude!, longitude: e.longitude! }) }))
        .sort((a, b) => a.d - b.d)[0];
      if (located && located.d <= LINK_POSITION_METERS) match = located.id;
    }
    if (!match && normalize(cp.title)) {
      match = candidates.find((e) => normalize(e.name) === normalize(cp.title))?.id;
    }
    if (!match && length > 0 && typeof cp.distanceMetersFromStart === "number") {
      const share = cp.distanceMetersFromStart / length;
      const nearest = candidates
        .map((e) => ({ id: e.id, gap: Math.abs(e.distanceMeters / eventLength - share) }))
        .sort((a, b) => a.gap - b.gap)[0];
      if (nearest && nearest.gap <= LINK_SHARE_TOLERANCE) match = nearest.id;
    }
    if (match) {
      out.set(cp.id, match);
      used.add(match);
    }
  });
  return out;
}

function aidCheckpoints(course: RaceCourse): RaceCourseCheckpoint[] {
  const mid = course.checkpoints.slice(1, -1);
  const tagged = mid.filter((cp) => cp.tags?.includes("aid"));
  return tagged.length > 0 ? tagged : mid;
}

/** Share of the room's aid checkpoints the mapping covers (1 when the course has none). */
export function aidCoverage(course: RaceCourse, mapping: Map<string, string>): number {
  const aids = aidCheckpoints(course);
  return aids.length === 0 ? 1 : aids.filter((cp) => mapping.has(cp.id)).length / aids.length;
}

export function isLinkable(course: RaceCourse, event: CourseHistoryEvent): boolean {
  return aidCoverage(course, mapCheckpoints(course, event)) >= LINK_MIN_AID_COVERAGE;
}

/** Event ids to auto-link, or [] when there is no unambiguous match. */
export function autoLinkEventIds(course: RaceCourse, events: readonly StoredCourseHistoryEvent[]): string[] {
  const start = course.checkpoints[0];
  const finish = course.checkpoints[course.checkpoints.length - 1];
  const length = roomLength(course);
  if (!start || !finish || course.checkpoints.length < 2 || length <= 0) return [];
  const near = (a: { latitude: number; longitude: number }, b: { latitude?: number; longitude?: number }) =>
    b.latitude !== undefined && b.longitude !== undefined &&
    geodesicDistanceMeters(a, { latitude: b.latitude, longitude: b.longitude }) <= AUTO_LINK_ENDPOINT_METERS;
  const matches = events.filter(({ event }) => {
    const first = event.checkpoints[0]!;
    const last = event.checkpoints[event.checkpoints.length - 1]!;
    return (
      near(start, first) &&
      near(finish, last) &&
      Math.abs(last.distanceMeters / length - 1) <= AUTO_LINK_LENGTH_TOLERANCE &&
      isLinkable(course, event)
    );
  });
  if (matches.length === 0) return [];
  const layout = (e: CourseHistoryEvent) => e.checkpoints.map((cp) => normalize(cp.name)).join("|");
  const first = layout(matches[0]!.event);
  return matches.every((m) => layout(m.event) === first) ? matches.map((m) => m.id) : [];
}
