/**
 * What CrewCue's own finished races say so far (plan PR 6): rooms per plan branch, measured plan σ
 * (applied once a branch has 20 rooms), measured slowdowns, and stop times by tag, race quarter
 * and darkness. Read-only.
 *
 *   PERSISTENCE_MODE=postgres DATABASE_URL=… npm run finished-efforts:report
 */
import { PLAN_LOG_SIGMA } from "../src/lib/projectionTuning.js";
import { listFinishedEfforts, measuredPlanLogSigma, PLAN_SIGMA_MIN_ROOMS, stopStats } from "../src/lib/finishedEffortStore.js";

const efforts = await listFinishedEfforts();
const out = (line = "") => process.stdout.write(`${line}\n`);
out(`Finished races: ${efforts.length}`);
const measured = measuredPlanLogSigma(efforts);
out("\nPlan accuracy by branch (σ = RMS of ln(actual ÷ planned finish)):");
for (const branch of Object.keys(PLAN_LOG_SIGMA) as Array<keyof typeof PLAN_LOG_SIGMA>) {
  const rooms = efforts.filter((e) => e.planBranch === branch && typeof e.planLogError === "number").length;
  const m = measured[branch];
  out(
    `  ${branch.padEnd(15)} rooms ${String(rooms).padStart(4)}   provisional σ ${PLAN_LOG_SIGMA[branch]}   ` +
      (m ? `measured σ ${m.sigma.toFixed(3)} (in use)` : `measured σ applies at ${PLAN_SIGMA_MIN_ROOMS} rooms`)
  );
}
const slopes = efforts.flatMap((e) => (typeof e.slowdownSlope === "number" ? [e.slowdownSlope] : []));
out(`\nMeasured slowdowns: ${slopes.length}` + (slopes.length ? `, mean ${(slopes.reduce((a, b) => a + b, 0) / slopes.length).toFixed(3)} (default 0.24)` : ""));
out("\nStops (median seconds; ratio to the crew's planned stop):");
for (const s of stopStats(efforts)) {
  out(`  ${s.tag.padEnd(9)} ${s.progressBand.padEnd(8)} ${s.dark ? "dark " : "light"}  n=${String(s.stops).padStart(4)}  ${Math.round(s.medianSeconds)} s  ${s.medianRatioToPlan === null ? "" : `×${s.medianRatioToPlan.toFixed(2)}`}`);
}
