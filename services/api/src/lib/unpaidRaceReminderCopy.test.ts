/**
 * The unpaid-race reminder copy: title, the three bodies, whole days rounded down (at least 1),
 * and never a clock time.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  UNPAID_REMINDER_NAME_MAX_CHARS,
  UNPAID_REMINDER_TITLE,
  unpaidRaceReminderCopy,
  wholeDaysUntil
} from "./unpaidRaceReminderCopy.js";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-17T15:30:00.000Z");

test("title and the three bodies, with the race's name", () => {
  assert.equal(UNPAID_REMINDER_TITLE, "Unlock your race");
  assert.deepEqual(unpaidRaceReminderCopy("expiry_7d", "Western States", NOW + 7 * DAY, NOW), {
    title: "Unlock your race",
    body: "Your race Western States will be deleted in 7 days. Unlock it to keep your course and plan."
  });
  assert.deepEqual(unpaidRaceReminderCopy("expiry_1d", "Western States", NOW + DAY, NOW), {
    title: "Unlock your race",
    body: "Your race Western States will be deleted tomorrow. Unlock it to keep your course and plan."
  });
  assert.deepEqual(unpaidRaceReminderCopy("race_soon", "Western States", NOW + 3 * DAY, NOW), {
    title: "Unlock your race",
    body: "Your race Western States is in 3 days. Unlock it so your crew can follow you."
  });
});

test("days are whole, rounded down, at least 1, and 1 is singular", () => {
  assert.equal(wholeDaysUntil(NOW + 7 * DAY, NOW), 7);
  assert.equal(wholeDaysUntil(NOW + 7 * DAY - 1, NOW), 6, "a millisecond short of 7 days is 6");
  assert.equal(wholeDaysUntil(NOW + 2 * DAY - HOUR, NOW), 1);
  assert.equal(wholeDaysUntil(NOW + HOUR, NOW), 1, "under a day is still 1");
  assert.equal(wholeDaysUntil(NOW - HOUR, NOW), 1, "never 0 or negative");
  assert.match(unpaidRaceReminderCopy("expiry_7d", "Hardrock", NOW + 4.9 * DAY, NOW).body, / in 4 days\./);
  assert.match(unpaidRaceReminderCopy("expiry_7d", "Hardrock", NOW + 1.5 * DAY, NOW).body, / in 1 day\./);
  assert.match(unpaidRaceReminderCopy("race_soon", "Hardrock", NOW + 2.5 * DAY, NOW).body, / is in 2 days\./);
  assert.match(unpaidRaceReminderCopy("race_soon", "Hardrock", NOW + 5 * HOUR, NOW).body, / is in 1 day\./);
  // expiry_1d always says tomorrow: it goes out a day before the delete.
  assert.match(unpaidRaceReminderCopy("expiry_1d", "Hardrock", NOW + 3 * HOUR, NOW).body, / tomorrow\./);
});

test("never a clock time, a date or a time zone", () => {
  for (const slot of ["expiry_7d", "expiry_1d", "race_soon"] as const) {
    for (const until of [NOW + HOUR, NOW + DAY + 7 * HOUR, NOW + 7 * DAY]) {
      const { title, body } = unpaidRaceReminderCopy(slot, "Leadville 100", until, NOW);
      assert.doesNotMatch(`${title} ${body}`, /\d{1,2}:\d{2}|AM|PM|UTC|GMT|2026|Nov/);
    }
  }
});

test("the name: whitespace collapsed, a long one cut with an ellipsis, none at all reads 'Your race'", () => {
  assert.equal(
    unpaidRaceReminderCopy("expiry_1d", "  Javelina\n  Jundred  ", NOW + DAY, NOW).body,
    "Your race Javelina Jundred will be deleted tomorrow. Unlock it to keep your course and plan."
  );
  const long = "A".repeat(UNPAID_REMINDER_NAME_MAX_CHARS + 20);
  const body = unpaidRaceReminderCopy("race_soon", long, NOW + 2 * DAY, NOW).body;
  assert.equal(body, `Your race ${"A".repeat(UNPAID_REMINDER_NAME_MAX_CHARS - 1)}… is in 2 days. Unlock it so your crew can follow you.`);
  for (const name of ["", "   ", undefined]) {
    assert.equal(
      unpaidRaceReminderCopy("expiry_7d", name, NOW + 7 * DAY, NOW).body,
      "Your race will be deleted in 7 days. Unlock it to keep your course and plan."
    );
  }
});
