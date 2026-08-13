/**
 * Display helpers for crew schedule sheet rows.
 *
 * Clocks: format the API's ISO-8601 UTC `clockArrivalAt` for local display only.
 * Do **not** recompute arrival from elapsed + raceStartAt — GPX may stamp planned dwell
 * on start (e.g. 600s), and the API projection already accounts for cumulative dwell/delay.
 *
 * Durations: API values are whole seconds; render as mm:ss (or h:mm:ss when ≥ 1 hour).
 */

/**
 * Format a duration in seconds as `mm:ss` or `h:mm:ss`.
 * @param totalSeconds non-negative duration from the API (elapsed, dwell, delay).
 */
export function formatDurationSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "—";
  }
  const sec = Math.floor(totalSeconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Format an API ISO-8601 UTC clock instant for display.
 * Uses the device locale; does not adjust from elapsed.
 */
export function formatScheduleClock(isoUtc: string): string {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
