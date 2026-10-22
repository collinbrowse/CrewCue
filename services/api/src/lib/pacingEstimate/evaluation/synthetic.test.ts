import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  corpusFileReader,
  createRng,
  generateAthletes,
  generateProfile,
  generateSyntheticCorpus,
  minettiRelativeCostTruth,
  simulateTruthElapsed,
  toblerSpeedMps,
  type SyntheticAthlete
} from "./synthetic.js";
import { evaluationCorpusDir } from "./testSupport.js";

const ATHLETE: SyntheticAthlete = {
  key: "t",
  referenceSpeedMps: 3,
  riegelExponent: 1.1,
  hikeGrade: 0.12,
  hikeFactor: 1.2,
  downhillGain: 0.3,
  descentToleranceMeters: 3000,
  altitudeSensitivity: 1,
  fade: 0
};

function constantGrade(grade: number, meters = 5000, base = 500): { distances: number[]; elevations: number[] } {
  const distances = Array.from({ length: 51 }, (_, index) => (index * meters) / 50);
  return { distances, elevations: distances.map((distance) => base + grade * distance) };
}

function finishSeconds(profile: { distances: number[]; elevations: number[] }, athlete = ATHLETE, total = 20_000): number {
  const elapsed = simulateTruthElapsed(profile.distances, profile.elevations, athlete, {
    effortDistanceMeters: total,
    form: 1,
    noiseSd: 0,
    rng: createRng("t")
  });
  return elapsed[elapsed.length - 1]!;
}

test("truth model: published-form sanity checks", () => {
  assert.ok(Math.abs(minettiRelativeCostTruth(0) - 1) < 1e-12);
  assert.ok(minettiRelativeCostTruth(0.1) > 1.4);
  assert.ok(minettiRelativeCostTruth(-0.1) < 0.7);
  assert.ok(toblerSpeedMps(-0.05) > toblerSpeedMps(0.1));

  const flat = finishSeconds(constantGrade(0));
  // Flat over 5 km at the 20 km reference speed with no noise = distance / speed.
  assert.ok(Math.abs(flat - 5000 / 3) < 1e-6);
  assert.ok(finishSeconds(constantGrade(0.06)) > flat);
  assert.ok(finishSeconds(constantGrade(-0.04)) < flat);
  // A steep technical descent is slower than flat despite the grade.
  assert.ok(finishSeconds(constantGrade(-0.3)) > flat);
  // Above the hike grade the athlete hikes: never faster than Tobler × factor.
  const steep = finishSeconds(constantGrade(0.2));
  assert.ok(steep >= 5000 / (toblerSpeedMps(0.2) * ATHLETE.hikeFactor) - 1e-6);
  // Longer efforts are slower per meter (Riegel exponent > 1).
  assert.ok(finishSeconds(constantGrade(0), ATHLETE, 160_000) > flat);
});

test("profile generator hits the requested gain and stays deterministic", () => {
  const spec = { lengthMeters: 50_000, gainMeters: 2000, baseElevationMeters: 300 };
  const a = generateProfile(spec, createRng("p"));
  const b = generateProfile(spec, createRng("p"));
  assert.deepEqual(a, b);
  const gain = a.elevations.reduce((sum, value, index) => (index === 0 ? sum : sum + Math.max(0, value - a.elevations[index - 1]!)), 0);
  assert.ok(Math.abs(gain - 2000) < 30, `gain ${gain}`);
  assert.equal(Math.min(...a.elevations), 300);
});

test("athletes differ from each other", () => {
  const athletes = generateAthletes();
  assert.equal(new Set(athletes.map((athlete) => athlete.referenceSpeedMps)).size, athletes.length);
});

test("committed synthetic corpus equals a fresh generation (no hand edits, no drift)", () => {
  const root = evaluationCorpusDir();
  const generated = generateSyntheticCorpus(corpusFileReader(root));
  for (const [relativePath, contents] of generated) {
    const path = resolve(root, relativePath);
    assert.ok(existsSync(path), `missing ${relativePath}; run npm run pacing:eval:synth -w @crewcue/api`);
    assert.equal(readFileSync(path, "utf8"), contents, `${relativePath} drifted; run npm run pacing:eval:synth -w @crewcue/api`);
  }
  const committedSynthetic = readdirSync(resolve(root, "efforts")).filter((name) => {
    const raw = JSON.parse(readFileSync(resolve(root, "efforts", name), "utf8")) as { provenance: { kind: string } };
    return raw.provenance.kind === "synthetic";
  });
  assert.equal(committedSynthetic.length, [...generated.keys()].filter((path) => path.startsWith("efforts/")).length);
});
