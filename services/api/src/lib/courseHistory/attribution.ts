/**
 * Credit lines for course-history sources, shown wherever past results shaped a plan.
 *
 * OpenSplitTime let CrewCue use its results and asked for an unobtrusive attribution line
 * (Nov 2026). Sources come from the cohort's event ids (`source:sourceEventId`); CrewCue's own
 * rooms and hand-made files need no credit.
 */
const CREDITS: Record<string, string> = {
  opensplittime: "OpenSplitTime.org"
};

/** " (results from OpenSplitTime.org)" when a credited source is among `eventIds`, else "". */
export function courseHistoryAttribution(eventIds: readonly string[]): string {
  const names = [...new Set(eventIds.map((id) => CREDITS[id.slice(0, id.indexOf(":"))]).filter((n): n is string => Boolean(n)))];
  return names.length > 0 ? ` (results from ${names.join(" and ")})` : "";
}
