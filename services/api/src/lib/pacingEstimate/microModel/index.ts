export {
  COLD_START_GAP_SECONDS_PER_MILE,
  SURFACE_COMPLEXITY,
  SCENARIO_CONSERVATIVE,
  SCENARIO_AGGRESSIVE,
  SCENARIO_EXPECTED,
  FATIGUE_GAMMA1_PER_METER_WORK,
  FATIGUE_GAMMA2_PER_METER_DESCENT,
  METERS_PER_MILE
} from "./constants.js";
export { buildCourseMicroSegments } from "./courseMesh.js";
export { buildRunnerProfile, coldStartGapSecondsPerMeter } from "./runnerProfile.js";
export {
  simulateMovingTime,
  interpolateElapsedAtDistance,
  minettiRelativeCost,
  altitudeFactor
} from "./simulate.js";
export {
  runScenarioSims,
  fatigueStateAtProgress,
  baselineTrackFromSimulation,
  elapsedAtCheckpoints,
  SCENARIO_KNOBS
} from "./scenarios.js";
export {
  estimatePacingMicroModel,
  estimatePacingMicroModelWithArtifacts,
  microModelPacingEstimator,
  type MicroModelEstimateInput,
  type MicroModelEstimateArtifacts
} from "./microModelEstimator.js";
export { computeLiveRemainingProjection, type LiveRemainingProjection } from "./liveRemaining.js";
