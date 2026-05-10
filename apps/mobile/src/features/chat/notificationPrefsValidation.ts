import type { ChatNotificationPref } from "@crewcue/contracts";

const VALID: readonly ChatNotificationPref[] = ["all", "mentions", "none"];

export function isValidPref(value: unknown): value is ChatNotificationPref {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}
