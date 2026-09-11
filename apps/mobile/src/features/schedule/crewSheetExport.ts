import type { CrewScheduleSheet, ScheduleStop } from "@crewcue/contracts";
import { formatDurationSeconds } from "./formatSchedule";

/**
 * Offline-printable crew sheet export (W4-3).
 *
 * Format: UTF-8 plaintext (not PDF). Built entirely from the in-memory
 * `CrewScheduleSheet` already on device — `buildCrewSheetExportText` never
 * fetches the network. After capture, the shared message is usable offline.
 *
 * Clocks: ISO-8601 UTC from the sheet (`clockArrivalAt`) plus a stable
 * `HH:MM UTC` wall clock derived from that ISO (no device locale).
 */

export type CrewSheetNoteBodies = {
  athleteNotes?: string;
  planNotes?: string;
};

export type BuildCrewSheetExportOptions = {
  /** Display titles keyed by checkpoint id; falls back to checkpointId. */
  titleByCheckpointId?: ReadonlyMap<string, string>;
  /** Optional note bodies when the sheet only carries note ids. */
  noteBodiesByCheckpointId?: ReadonlyMap<string, CrewSheetNoteBodies>;
  /** ISO capture stamp for the snapshot header (defaults to now). */
  capturedAtIso?: string;
};

/** Stable UTC `HH:MM` from an ISO instant (locale-independent for snapshots). */
export function formatUtcHhMm(isoUtc: string): string {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) {
    return "—";
  }
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

function formatCutoffLine(stop: ScheduleStop): string | undefined {
  if (stop.cutoffStatus === undefined) {
    return undefined;
  }
  const margin =
    typeof stop.cutoffMarginSeconds === "number"
      ? ` (margin ${formatDurationSeconds(Math.abs(stop.cutoffMarginSeconds))}${
          stop.cutoffMarginSeconds < 0 ? " over" : stop.cutoffMarginSeconds === 0 ? " at" : " under"
        })`
      : "";
  return `   Cutoff: ${stop.cutoffStatus}${margin}`;
}

function formatStopBlock(
  index: number,
  stop: ScheduleStop,
  title: string,
  notes: CrewSheetNoteBodies | undefined
): string {
  const lines: string[] = [
    `${index}. ${title}`,
    `   Arrival: ${stop.clockArrivalAt} (${formatUtcHhMm(stop.clockArrivalAt)})`,
    `   Elapsed: ${formatDurationSeconds(stop.elapsedSeconds)}`,
    `   Stoppage: ${formatDurationSeconds(stop.plannedStoppageSeconds)}`
  ];
  if (typeof stop.delayOverrideSeconds === "number") {
    lines.push(`   Delay: ${formatDurationSeconds(stop.delayOverrideSeconds)}`);
  }
  if (notes?.athleteNotes) {
    lines.push(`   Athlete notes: ${notes.athleteNotes}`);
  } else if (stop.notes?.athleteNotesId) {
    lines.push(`   Athlete notes: (id ${stop.notes.athleteNotesId})`);
  }
  if (notes?.planNotes) {
    lines.push(`   Plan notes: ${notes.planNotes}`);
  } else if (stop.notes?.planNotesId) {
    lines.push(`   Plan notes: (id ${stop.notes.planNotesId})`);
  }
  const cutoff = formatCutoffLine(stop);
  if (cutoff) {
    lines.push(cutoff);
  }
  return lines.join("\n");
}

/**
 * Build a plaintext crew sheet snapshot from the loaded schedule model.
 * Does not perform any network I/O.
 */
export function buildCrewSheetExportText(
  sheet: CrewScheduleSheet | null,
  options: BuildCrewSheetExportOptions = {}
): string {
  const capturedAt = options.capturedAtIso ?? new Date().toISOString();
  const header = [
    "CrewCue offline crew sheet",
    `Captured: ${capturedAt}`,
    "Format: plaintext (Share / Messages / AirPrint from the system share sheet).",
    "This snapshot was built from the schedule already on device — no network refetch."
  ];

  if (!sheet) {
    return [...header, "", "No schedule loaded."].join("\n");
  }

  const titleByCheckpointId = options.titleByCheckpointId ?? new Map<string, string>();
  const noteBodies = options.noteBodiesByCheckpointId ?? new Map<string, CrewSheetNoteBodies>();

  const lines = [
    ...header,
    "",
    `Room: ${sheet.roomId}`,
    `Race start: ${sheet.raceStartAt} (${formatUtcHhMm(sheet.raceStartAt)})`,
    ""
  ];

  if (sheet.stops.length === 0) {
    lines.push("No stops on this schedule.");
    return lines.join("\n");
  }

  lines.push(`Stops: ${sheet.stops.length}`, "");
  sheet.stops.forEach((stop, index) => {
    const title = titleByCheckpointId.get(stop.checkpointId) ?? stop.checkpointId;
    lines.push(formatStopBlock(index + 1, stop, title, noteBodies.get(stop.checkpointId)));
    lines.push("");
  });

  return lines.join("\n").trimEnd() + "\n";
}
