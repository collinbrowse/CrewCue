#!/usr/bin/env node
/**
 * Tells Slack when CI on main goes red, stays red, and goes green again.
 *
 *   node scripts/ci-main-alert.mjs --run <CI run id>   report that run (main-alert.yml does this after each run)
 *   node scripts/ci-main-alert.mjs --status            is main green now, and where was it last green
 *
 * Posts to the Slack incoming webhook in SLACK_CI_WEBHOOK. Without it, or with --dry-run, the
 * message is printed and nothing is sent. REPLAY=true marks the message as a replay of an old run.
 * Process for whoever reads the alert: docs/runbooks/red-main.md.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKFLOW = "ci.yml";
/** A PR run says nothing about main. */
const MAIN_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
/** A cancelled run was replaced by a newer commit's run; it is neither red nor green. */
const VERDICTS = new Set(["success", "failure", "timed_out", "startup_failure"]);
const MAX_COMMITS = 8;

export function isRed(run) {
  return run.conclusion !== "success";
}

/** Runs that say whether main is red or green, newest first. */
export function verdictRuns(runs) {
  return runs
    .filter((run) => run.head_branch === "main" && MAIN_EVENTS.has(run.event) && VERDICTS.has(run.conclusion))
    .sort((a, b) => b.run_number - a.run_number);
}

/**
 * Where `run` sits in main's history.
 * @returns {{ previous?: object, lastGreen?: object, redStreak: number, firstRed?: object }}
 * redStreak counts the red runs directly before `run`.
 */
export function history(run, runs) {
  const older = verdictRuns(runs).filter((other) => other.run_number < run.run_number);
  const previous = older[0];
  const lastGreen = older.find((other) => !isRed(other));
  const greenAt = older.findIndex((other) => !isRed(other));
  const reds = greenAt === -1 ? older : older.slice(0, greenAt);
  return { previous, lastGreen, redStreak: reds.length, firstRed: reds[reds.length - 1] };
}

/** "alert" on the first red run, "still-red" on the next ones, "recovered" on the first green one. */
export function decide(run, past) {
  if (!VERDICTS.has(run.conclusion)) return "none";
  if (isRed(run)) return past.previous && isRed(past.previous) ? "still-red" : "alert";
  return past.previous && isRed(past.previous) ? "recovered" : "none";
}

/** Slack reads &, < and > as markup. Commit titles are written by whoever made the commit. */
export function escapeSlack(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function link(url, text) {
  return `<${url}|${escapeSlack(text)}>`;
}

function shortSha(sha) {
  return String(sha).slice(0, 7);
}

function commitLink(repo, sha) {
  return link(`https://github.com/${repo}/commit/${sha}`, shortSha(sha));
}

/** `ios` (step name), or `ios` (no runner started it) when GitHub never assigned a machine. */
export function describeFailedJobs(jobs) {
  const failed = jobs.filter((job) => ["failure", "cancelled", "timed_out"].includes(job.conclusion));
  return failed.map((job) => {
    const step = (job.steps ?? []).find((s) => s.conclusion === "failure" || s.conclusion === "cancelled");
    let why = step ? step.name : "";
    if (!step && job.conclusion === "cancelled" && (job.steps ?? []).length === 0) why = "no runner started it";
    if (!step && job.conclusion === "timed_out") why = "timed out";
    return why ? `\`${job.name}\` (${escapeSlack(why)})` : `\`${job.name}\``;
  });
}

export function buildMessage({ kind, repo, run, jobs = [], past, commits = [], replay = false }) {
  const prefix = replay ? "[replay] " : "";
  const runLink = link(run.html_url, `CI run ${run.run_number}`);
  const at = commitLink(repo, run.head_sha);
  const failed = describeFailedJobs(jobs).join(", ") || "see the run";

  if (kind === "still-red") {
    return `${prefix}:red_circle: main is still red, ${past.redStreak + 1} runs in a row, at ${at}. Failed: ${failed}. ${runLink}`;
  }
  if (kind === "recovered") {
    const since = past.firstRed ? ` since ${past.firstRed.created_at.slice(0, 16).replace("T", " ")} UTC` : "";
    const count = past.redStreak === 1 ? "1 red run" : `${past.redStreak} red runs`;
    return `${prefix}:large_green_circle: *main is green again* at ${at}, after ${count}${since}. ${runLink}`;
  }
  const lines = [`${prefix}:red_circle: *main is red* at ${at}. ${runLink}`, `Failed: ${failed}`];
  if (!past.lastGreen) {
    lines.push("No green run found in recent history.");
  } else {
    const count = commits.length === 1 ? "1 commit" : `${commits.length} commits`;
    lines.push(`Since the last green run (${commitLink(repo, past.lastGreen.head_sha)}): ${count}`);
    for (const commit of commits.slice(0, MAX_COMMITS)) {
      const title = commit.commit.message.split("\n")[0].slice(0, 90);
      lines.push(`• ${commitLink(repo, commit.sha)} ${escapeSlack(title)}`);
    }
    if (commits.length > MAX_COMMITS) lines.push(`• and ${commits.length - MAX_COMMITS} more`);
  }
  return lines.join("\n");
}

export function statusLine(runs, repo) {
  const verdicts = verdictRuns(runs);
  const newest = verdicts[0];
  if (!newest) return "main: no finished CI run found";
  const lastGreen = verdicts.find((run) => !isRed(run));
  const where = lastGreen ? `last green at ${shortSha(lastGreen.head_sha)} (${lastGreen.created_at})` : "no green run in recent history";
  if (!isRed(newest)) return `main is green at ${shortSha(newest.head_sha)} (https://github.com/${repo}/actions/runs/${newest.id})`;
  return `main is RED at ${shortSha(newest.head_sha)} (https://github.com/${repo}/actions/runs/${newest.id}); ${where}`;
}

function gh(path) {
  const result = spawnSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`gh api ${path} failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

function repoName() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const result = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("could not tell which repository this is");
  return result.stdout.trim();
}

function recentRuns(repo) {
  return gh(`repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=main&status=completed&per_page=100`).workflow_runs;
}

async function main(argv) {
  const repo = repoName();
  if (argv.includes("--status")) {
    console.log(statusLine(recentRuns(repo), repo));
    return;
  }
  const runId = argv[argv.indexOf("--run") + 1];
  if (!argv.includes("--run") || !/^\d+$/.test(runId ?? "")) {
    console.error("usage: ci-main-alert.mjs --run <CI run id> [--dry-run] | --status");
    process.exit(2);
  }
  const run = gh(`repos/${repo}/actions/runs/${runId}`);
  if (run.head_branch !== "main" || !MAIN_EVENTS.has(run.event)) {
    console.log(`ci-main-alert: run ${runId} is not a main run (${run.event} on ${run.head_branch}), nothing to say`);
    return;
  }
  const past = history(run, recentRuns(repo));
  const kind = decide(run, past);
  if (kind === "none") {
    console.log(`ci-main-alert: run ${runId} is ${run.conclusion}, nothing to say`);
    return;
  }
  const jobs = kind === "recovered" ? [] : gh(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`).jobs;
  const commits =
    kind === "alert" && past.lastGreen
      ? gh(`repos/${repo}/compare/${past.lastGreen.head_sha}...${run.head_sha}`).commits.reverse()
      : [];
  const text = buildMessage({ kind, repo, run, jobs, past, commits, replay: process.env.REPLAY === "true" });
  console.log(text);

  const webhook = process.env.SLACK_CI_WEBHOOK;
  if (argv.includes("--dry-run") || !webhook) {
    console.log(`ci-main-alert: not sent (${webhook ? "dry run" : "SLACK_CI_WEBHOOK is not set"})`);
    return;
  }
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    console.error(`ci-main-alert: Slack answered ${response.status}`);
    process.exit(1);
  }
  console.log("ci-main-alert: sent");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`ci-main-alert: ${error.message}`);
    process.exit(1);
  });
}
