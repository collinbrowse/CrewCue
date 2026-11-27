#!/usr/bin/env node
/**
 * The staging smoke failed after a deploy. What should happen next?
 *
 *   node scripts/staging-smoke-failure.mjs --sha <deployed commit> --last-good <commit|""> --report <file>
 *
 * staging-smoke.yml runs this in its `triage` job. It lists the commits on main between the last
 * deploy whose smoke passed and the one that failed, and picks one of two actions:
 *
 *   revert  exactly one commit is new and it adds no migration: open a revert PR for it.
 *   issue   anything else: report the suspects and let a person or an agent choose.
 *
 * Writes `action`, `sha` and `reason` to $GITHUB_OUTPUT and a Markdown report to --report.
 * Needs full history (fetch-depth: 0).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Migrations only run forward: reverting the code leaves the schema changed. */
const MIGRATIONS = "services/api/db/migrations/";

/**
 * @param {{ lastGood: string, suspects: { sha: string, subject: string, files: string[] }[] }} input
 * suspects: first-parent commits on main after lastGood, up to the deployed one.
 * @returns {{ action: "revert" | "issue", sha?: string, reason: string }}
 */
export function decide({ lastGood, suspects }) {
  if (!lastGood)
    return { action: "issue", reason: "No earlier deploy has passed the smoke, so there is nothing to compare with." };
  if (suspects.length === 0)
    return { action: "issue", reason: "No new commit since the last passing deploy. Suspect staging itself (Auth0, the database, Railway), not the code." };
  if (suspects.length > 1)
    return { action: "issue", reason: `${suspects.length} commits landed since the last passing deploy, so the cause is not known.` };
  const [only] = suspects;
  if (only.files.some((file) => file.startsWith(MIGRATIONS)))
    return { action: "issue", reason: "The only new commit adds a migration. Migrations only run forward, so reverting the code may not be safe: fix forward or check the schema first." };
  return { action: "revert", sha: only.sha, reason: "One commit landed since the last passing deploy." };
}

export function report({ sha, lastGood, suspects, verdict, runUrl }) {
  const lines = [
    `The staging smoke failed after \`${sha.slice(0, 7)}\` was deployed${runUrl ? `: ${runUrl}` : "."}`,
    "",
    `Last deploy that passed: ${lastGood ? `\`${lastGood.slice(0, 7)}\`` : "none on record"}.`,
    "",
    verdict.reason,
  ];
  if (suspects.length > 0) {
    lines.push("", "Commits since then:", "");
    for (const commit of suspects) lines.push(`- \`${commit.sha.slice(0, 7)}\` ${commit.subject}`);
  }
  return `${lines.join("\n")}\n`;
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function suspectsBetween(lastGood, sha) {
  if (!lastGood) return [];
  return git(["log", "--first-parent", "--format=%H %s", `${lastGood}..${sha}`])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const commit = line.slice(0, line.indexOf(" "));
      return {
        sha: commit,
        subject: line.slice(line.indexOf(" ") + 1),
        files: git(["diff", "--name-only", `${commit}^1`, commit]).split("\n").filter(Boolean),
      };
    });
}

function main(argv) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? "" : "");
  const sha = arg("--sha");
  if (!sha) {
    console.error("usage: staging-smoke-failure.mjs --sha <commit> [--last-good <commit>] [--report <file>]");
    process.exit(2);
  }
  let lastGood = arg("--last-good");
  // A run whose commit is gone from history (a force-push) cannot be compared with.
  if (lastGood && spawnSync("git", ["cat-file", "-e", `${lastGood}^{commit}`]).status !== 0) lastGood = "";
  const suspects = suspectsBetween(lastGood, sha);
  const verdict = decide({ lastGood, suspects });
  const text = report({ sha, lastGood, suspects, verdict, runUrl: process.env.RUN_URL });
  if (arg("--report")) fs.writeFileSync(arg("--report"), text);
  console.log(text);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `action=${verdict.action}\nsha=${verdict.sha ?? ""}\nreason=${verdict.reason}\n`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
