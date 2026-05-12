import { DateTime } from "luxon";

/** Curated IANA zones when `Intl.supportedValuesOf("timeZone")` is unavailable. */
export const FALLBACK_IANA_TIME_ZONES: readonly string[] = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "America/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Moscow",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland"
] as const;

export function listIanaTimeZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
      "timeZone"
    );
    if (Array.isArray(supported) && supported.length > 0) {
      const merged = new Set<string>([...supported, ...FALLBACK_IANA_TIME_ZONES]);
      return [...merged].sort((a, b) => a.localeCompare(b));
    }
  } catch {
    // ignore
  }
  return [...FALLBACK_IANA_TIME_ZONES];
}

export function normalizeRaceStartIso(iso: string): string | null {
  const trimmed = iso.trim();
  if (!trimmed) {
    return null;
  }
  const dt = DateTime.fromISO(trimmed, { setZone: true });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

export function defaultSuggestedRaceStartIso(deviceTimeZone: string): string {
  const zone = deviceTimeZone.trim() || "UTC";
  const base = DateTime.now().setZone(zone).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  return base.toUTC().toISO() ?? new Date().toISOString();
}

export function formatRaceStartSummary(iso: string, locale: string, displayTimeZone: string): string {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(displayTimeZone);
  if (!dt.isValid) {
    return "";
  }
  const datePart = dt.setLocale(locale).toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY);
  const timePart = dt.setLocale(locale).toLocaleString(DateTime.TIME_SIMPLE);
  return `${datePart} · ${timePart}`;
}
