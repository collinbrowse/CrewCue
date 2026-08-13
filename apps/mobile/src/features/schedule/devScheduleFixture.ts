import { parseCrewScheduleSheet, type CrewScheduleSheet } from "@crewcue/contracts";
import scheduleExpected from "../../../../../fixtures/pacing/schedule-expected.json";

/**
 * DEV-only schedule sheet from `fixtures/pacing/schedule-expected.json`.
 * Used by `crewcue://dev/schedule-sheet` so simulator QA can assert stop rows without Auth0.
 * Never used as a production auth/session bypass.
 */
export function loadDevScheduleFixtureSheet(): CrewScheduleSheet {
  return parseCrewScheduleSheet(scheduleExpected.sheet);
}

/** Stable titles for fixture checkpoint ids (display-only; clocks still from API fixture). */
export const DEV_SCHEDULE_CHECKPOINT_TITLES: ReadonlyMap<string, string> = new Map([
  ["start", "Start"],
  ["aid-1", "Aid 1"],
  ["aid-2", "Aid 2"],
  ["aid-3", "Aid 3"],
  ["finish", "Finish"]
]);
