#!/usr/bin/env node
/**
 * How long has main's code been ahead of docs/kb/generated?
 *
 *   node scripts/kb/unrefreshed-age.mjs --max-hours 30
 *
 * kb-refresh.yml rebuilds the generated pages once a day, so they trail the code by up to a day.
 * kb-drift-watch.yml runs this when the pages are stale: exit 0 while the oldest change they have
 * not caught up with is younger than --max-hours, exit 1 once it is older (the refresh has stopped).
 * Needs full history (fetch-depth: 0).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** What a refresh commits: the fact pages, and the commit the narrative was reconciled against. */
const REFRESHED = ["docs/kb/generated", "docs/kb/.refresh-sha"];

/**
 * @param {{ codeTimes: number[], refreshTime: number, now: number, maxHours: number }} input
 * codeTimes: commit times (seconds) of the code commits on main after the last refresh.
 * A refresh is built from an older commit than the one it merges on, so stale pages with no later
 * code commit are waiting since the refresh itself.
 */
export function lag({ codeTimes, refreshTime, now, maxHours }) {
  const since = codeTimes.length > 0 ? Math.min(...codeTimes) : refreshTime;
  const hours = Math.max(0, (now - since) / 3600);
  return { hours, ok: hours <= maxHours };
}

function git(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function main(argv) {
  const maxHours = Number(argv[argv.indexOf("--max-hours") + 1]);
  if (!argv.includes("--max-hours") || !(maxHours > 0)) {
    console.error("usage: unrefreshed-age.mjs --max-hours <hours>");
    process.exit(2);
  }
  const [refresh, refreshTime] = git([
    "log",
    "-1",
    "--first-parent",
    "--format=%H %ct",
    "--",
    ...REFRESHED,
  ]).split(" ");
  if (!refresh)
    throw new Error(`no commit has touched ${REFRESHED.join(" or ")}`);
  const codeTimes = git([
    "log",
    "--first-parent",
    "--format=%ct",
    `${refresh}..HEAD`,
    "--",
    ".",
    ":(exclude)docs/kb",
  ])
    .split("\n")
    .filter(Boolean)
    .map(Number);
  const { hours, ok } = lag({
    codeTimes,
    refreshTime: Number(refreshTime),
    now: Date.now() / 1000,
    maxHours,
  });
  const what = `${codeTimes.length} code commit(s) since the last refresh (${refresh.slice(0, 7)}), waiting ${hours.toFixed(1)} h`;
  if (ok) {
    console.log(`::notice::KB is stale, within a day's lag: ${what}.`);
    return;
  }
  console.log(
    `::error::KB refresh has stopped: ${what}, more than ${maxHours} h.`,
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`unrefreshed-age: ${error.message}`);
    process.exit(1);
  }
}
