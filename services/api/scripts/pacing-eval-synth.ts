/**
 * Regenerate the SYNTHETIC part of the pacing evaluation corpus (fixtures/pacing/eval).
 *
 * Usage: npm run pacing:eval:synth -w @crewcue/api
 *
 * Only writes `courses/syn-*.gpx` and efforts with `provenance.kind: "synthetic"`; real efforts
 * are never touched. Afterwards, review `npm run pacing:eval` and re-record the gate with
 * `--write-baseline`. A test fails if the committed synthetic files drift from this generator.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusFileReader, generateSyntheticCorpus } from "../src/lib/pacingEstimate/evaluation/synthetic.js";

function corpusDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "course-50k-with-aids.gpx"))) {
      return resolve(candidate, "eval");
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found (looked up the directory tree)");
}

function main(): void {
  const root = corpusDir();
  mkdirSync(resolve(root, "efforts"), { recursive: true });
  mkdirSync(resolve(root, "courses"), { recursive: true });

  // Remove stale synthetic outputs so a shrinking generator leaves nothing behind.
  for (const name of readdirSync(resolve(root, "efforts"))) {
    const path = resolve(root, "efforts", name);
    const kind = (JSON.parse(readFileSync(path, "utf8")) as { provenance?: { kind?: string } }).provenance?.kind;
    if (kind === "synthetic") {
      rmSync(path);
    }
  }
  for (const name of readdirSync(resolve(root, "courses"))) {
    if (name.startsWith("syn-")) {
      rmSync(resolve(root, "courses", name));
    }
  }

  const files = generateSyntheticCorpus(corpusFileReader(root));
  for (const [relativePath, contents] of files) {
    writeFileSync(resolve(root, relativePath), contents);
  }
  process.stdout.write(`Wrote ${files.size} synthetic files to ${root}\n`);
}

main();
