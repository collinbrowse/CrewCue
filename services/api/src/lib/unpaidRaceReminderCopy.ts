/**
 * The words of the unpaid-race reminder pushes (lib/unpaidRaceReminderScheduler.ts). One module so
 * the copy is reviewed and tested in one place. Pure: no storage, no clock of its own.
 *
 * Counts are whole days, rounded down, at least 1, and the copy never shows a clock time: the
 * phone may show it hours later, in another time zone.
 */
import type { UnpaidReminderSlot } from "./unpaidRaceReminderScheduler.js";

const DAY_MS = 24 * 60 * 60_000;
/** Longest race name the body carries before it is cut with an ellipsis. */
export const UNPAID_REMINDER_NAME_MAX_CHARS = 60;

export const UNPAID_REMINDER_TITLE = "Unlock your race";

/** Whole days from `nowMs` to `atMs`, rounded down, at least 1. */
export function wholeDaysUntil(atMs: number, nowMs: number): number {
  return Math.max(1, Math.floor((atMs - nowMs) / DAY_MS));
}

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

/** "Your race Western States" (whitespace collapsed, cut at 60 characters), or "Your race" without a name. */
function yourRace(name: string | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return "Your race";
  }
  const shown =
    clean.length > UNPAID_REMINDER_NAME_MAX_CHARS ? `${clean.slice(0, UNPAID_REMINDER_NAME_MAX_CHARS - 1)}…` : clean;
  return `Your race ${shown}`;
}

/**
 * Title and body for one reminder sent at `nowMs`. `untilMs` is when the race is deleted
 * (`expiry_7d`, `expiry_1d`) or when it starts (`race_soon`). `expiry_1d` always says "tomorrow":
 * it is sent a day before the delete, and the sweeper waits 24 hours after it.
 */
export function unpaidRaceReminderCopy(
  slot: UnpaidReminderSlot,
  raceName: string | undefined,
  untilMs: number,
  nowMs: number
): { title: string; body: string } {
  const race = yourRace(raceName);
  switch (slot) {
    case "expiry_7d":
      return {
        title: UNPAID_REMINDER_TITLE,
        body: `${race} will be deleted in ${days(wholeDaysUntil(untilMs, nowMs))}. Unlock it to keep your course and plan.`
      };
    case "expiry_1d":
      return {
        title: UNPAID_REMINDER_TITLE,
        body: `${race} will be deleted tomorrow. Unlock it to keep your course and plan.`
      };
    case "race_soon":
      return {
        title: UNPAID_REMINDER_TITLE,
        body: `${race} is in ${days(wholeDaysUntil(untilMs, nowMs))}. Unlock it so your crew can follow you.`
      };
  }
}
