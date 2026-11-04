/**
 * Arrival-window quantile table, written by
 * `npm run projection:backtest -- --analysis windows --write-windows`.
 *
 * Empty on purpose: the only real race data analysed so far is the Nov 3–4 2026 scrape, mostly
 * OpenSplitTime, and fitting CrewCue's constants on it needs OpenSplitTime's permission. With no
 * table, the projection sends no windows and clients show the ETA alone. Refit on permitted data
 * (LiveTrail if its terms allow, or CrewCue's own finished races) and commit the generated table.
 */
import type { WindowTable } from "./arrivalWindows.js";

export const ARRIVAL_WINDOW_TABLE: WindowTable | null = null;
