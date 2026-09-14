/**
 * Shared predicted-vs-actual table printer for pacing backtest CLIs.
 */
import type { BacktestResult } from "../src/lib/pacingEstimate/backtest.js";

function formatHms(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const s = Math.abs(Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatSignedHms(seconds: number | null): string {
  if (seconds === null) {
    return "     —   ";
  }
  return `${seconds >= 0 ? "+" : ""}${formatHms(seconds)}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function printPacingBacktestResult(result: BacktestResult, out: NodeJS.WritableStream = process.stdout): void {
  out.write(`\n=== ${result.name} ===\n`);
  out.write(
    `course ${(result.courseLengthMeters / 1000).toFixed(2)} km · ${result.coldStart ? "COLD START" : "history-backed"}\n`
  );
  out.write(`${result.explanation}\n\n`);
  out.write(
    `${pad("Checkpoint", 16)}${pad("Dist(km)", 10)}${pad("Predicted", 12)}${pad("Actual", 12)}${pad("SignedErr", 12)}\n`
  );
  for (const row of result.rows) {
    out.write(
      pad(row.label, 16) +
        pad((row.distanceMetersFromStart / 1000).toFixed(2), 10) +
        pad(formatHms(row.predictedElapsedSeconds), 12) +
        pad(row.actualElapsedSeconds === null ? "—" : formatHms(row.actualElapsedSeconds), 12) +
        pad(formatSignedHms(row.signedErrorSeconds), 12) +
        "\n"
    );
  }
  out.write(
    `\nFinish predicted ${formatHms(result.finishPredictedElapsedSeconds)} · ` +
      `actual ${result.finishActualElapsedSeconds === null ? "—" : formatHms(result.finishActualElapsedSeconds)} · ` +
      `signed error ${formatSignedHms(result.finishSignedErrorSeconds)}\n`
  );
  out.write(`MAE ${formatHms(result.meanAbsoluteErrorSeconds)} over ${result.scoredRowCount} scored checkpoint(s)\n`);
}
