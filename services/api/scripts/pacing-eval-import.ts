/**
 * Add a real completed effort to the pacing evaluation corpus (docs/sdlc/pacing-evaluation.md).
 *
 * Usage (paths relative to the repo root or absolute):
 *   npm run pacing:eval:import -w @crewcue/api -- \
 *     --id tmr-100k-2026 --group athlete-collin \
 *     --course path/to/course.gpx --race path/to/race-recording.gpx \
 *     --training path/to/run1.gpx --training path/to/run2.gpx \
 *     --contributor "Collin Browse" --consent "own data"
 *
 * Optional: --history-json rows.json (array of ActivityHistoryRef recorded before the race, e.g. a
 *           Strava summary export), --tag 100k, --public-source URL --license CC-BY-4.0 (instead of
 *           --contributor/--consent for redistributable public data), --corpus DIR, --force.
 *
 * Writes `<corpus>/courses/<id>.gpx` (the planned course) and `<corpus>/efforts/<id>.json` (split
 * seconds + history summaries). The race and training tracks themselves are NOT stored.
 * Afterwards run `npm run pacing:eval -w @crewcue/api` and re-record the gate with --write-baseline.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseEvaluationEffort, type EffortProvenance } from "../src/lib/pacingEstimate/evaluation/corpus.js";
import { buildEffortFromGpx } from "../src/lib/pacingEstimate/evaluation/gpxImport.js";

function defaultCorpusDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing/eval");
    if (existsSync(resolve(candidate, "efforts"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing/eval not found (looked up the directory tree)");
}

/** npm -w runs scripts from services/api; resolve user paths against where npm was invoked. */
function userPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function main(): void {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      group: { type: "string" },
      course: { type: "string" },
      race: { type: "string" },
      training: { type: "string", multiple: true, default: [] },
      "history-json": { type: "string" },
      contributor: { type: "string" },
      consent: { type: "string" },
      "public-source": { type: "string" },
      license: { type: "string" },
      tag: { type: "string", multiple: true, default: [] },
      corpus: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]!.replace("/**", "") + "\n");
    return;
  }
  for (const required of ["id", "group", "course", "race"] as const) {
    if (!values[required]) {
      throw new Error(`--${required} is required (see --help)`);
    }
  }
  let provenance: EffortProvenance;
  if (values["public-source"]) {
    if (!values.license) {
      throw new Error("--license is required with --public-source");
    }
    provenance = { kind: "public", source: values["public-source"], license: values.license };
  } else {
    if (!values.contributor || !values.consent) {
      throw new Error("--contributor and --consent are required for an own effort (only add data you own or have explicit consent for)");
    }
    provenance = { kind: "own-effort", contributor: values.contributor, consent: values.consent };
  }

  const corpusDir = values.corpus ? userPath(values.corpus) : defaultCorpusDir();
  const id = values.id!;
  const effortPath = resolve(corpusDir, "efforts", `${id}.json`);
  if (existsSync(effortPath) && !values.force) {
    throw new Error(`${effortPath} exists; pass --force to replace it`);
  }
  const coursePath = `courses/${id}.gpx`;
  const courseSource = userPath(values.course!);
  const historyRows = values["history-json"]
    ? (JSON.parse(readFileSync(userPath(values["history-json"]), "utf8")) as unknown[])
    : [];

  const effort = buildEffortFromGpx({
    id,
    group: values.group!,
    provenance,
    coursePath,
    courseGpxXml: readFileSync(courseSource, "utf8"),
    raceGpxXml: readFileSync(userPath(values.race!), "utf8"),
    trainingGpxXmls: values.training.map((path) => ({ label: basename(path), xml: readFileSync(userPath(path), "utf8") })),
    historyRows: historyRows as never,
    ...(values.tag.length > 0 ? { tags: values.tag } : {})
  });
  // Validate exactly as the loader will (pre-race history, finish split, ids).
  parseEvaluationEffort(JSON.parse(JSON.stringify(effort)), `${id}.json`);

  mkdirSync(resolve(corpusDir, "courses"), { recursive: true });
  mkdirSync(resolve(corpusDir, "efforts"), { recursive: true });
  copyFileSync(courseSource, resolve(corpusDir, coursePath));
  writeFileSync(effortPath, `${JSON.stringify(effort, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${effortPath}\n${effort.actualSplits.length} splits, ${effort.history.length} history rows.\n` +
      "Next: npm run pacing:eval -w @crewcue/api, then -- --write-baseline once the numbers are reviewed.\n"
  );
}

main();
