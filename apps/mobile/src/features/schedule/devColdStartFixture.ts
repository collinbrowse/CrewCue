import {
  parseCrewScheduleSheet,
  parsePacingEstimate,
  type CrewScheduleSheet,
  type PacingEstimate
} from "@crewcue/contracts";
import estimateColdStart from "../../../../../fixtures/pacing/estimate-cold-start.json";
import scheduleExpected from "../../../../../fixtures/pacing/schedule-expected.json";

export type DevColdStartFixturePack = {
  sheet: CrewScheduleSheet;
  estimate: PacingEstimate;
};

/**
 * DEV-only cold-start estimate + coarse schedule sheet from
 * `fixtures/pacing/estimate-cold-start.json`.
 * Used by `crewcue://dev/cold-start` for Auth0-free simulator QA.
 */
export function loadDevColdStartFixture(): DevColdStartFixturePack {
  return {
    sheet: parseCrewScheduleSheet(estimateColdStart.sheet),
    estimate: parsePacingEstimate(estimateColdStart.estimate)
  };
}

/**
 * History-backed estimate + golden sheet after athlete history arrives (EC5).
 * Reuses `fixtures/pacing/schedule-expected.json` — not a production auth bypass.
 */
export function loadDevHistoryBackedFixture(): DevColdStartFixturePack {
  return {
    sheet: parseCrewScheduleSheet(scheduleExpected.sheet),
    estimate: parsePacingEstimate(scheduleExpected.estimate)
  };
}

/** True when the estimate UI should show the cold-start prompt. */
export function shouldShowColdStartPrompt(estimate: PacingEstimate | null | undefined): boolean {
  return estimate?.coldStart === true;
}
