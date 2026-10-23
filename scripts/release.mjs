#!/usr/bin/env node
/**
 * Tag a mobile release. The Release workflow builds and uploads on the pushed tag.
 * Usage: npm run release -- 1.4.0 [--dry-run]
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((arg) => !arg.startsWith("-"));

function die(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function git(...gitArgs) {
  const result = spawnSync("git", gitArgs, { encoding: "utf8" });
  if (result.status !== 0) die(`git ${gitArgs.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function parse(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text ?? "");
  return match ? match.slice(1).map(Number) : undefined;
}

function greater(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

const next = parse(version);
if (!next) die("usage: npm run release -- X.Y.Z [--dry-run]");
const tag = `v${next.join(".")}`;

if (git("status", "--porcelain")) die("working tree is not clean");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") die("check out main first");
git("fetch", "--quiet", "--tags", "origin", "main");
const head = git("rev-parse", "HEAD");
if (head !== git("rev-parse", "origin/main")) die("main is not in sync with origin/main");

const latest = git("tag", "--list", "v*.*.*", "--sort=-v:refname").split("\n").map(parse).find(Boolean);
if (latest && !greater(next, latest)) die(`${tag} must be greater than v${latest.join(".")}`);

const runs = spawnSync(
  "gh",
  ["run", "list", "--workflow", "CI", "--commit", head, "--json", "conclusion,status", "--limit", "1"],
  { encoding: "utf8" }
);
if (runs.status !== 0) die(`gh run list failed: ${runs.stderr.trim()}`);
const [run] = JSON.parse(runs.stdout || "[]");
if (!run || run.status !== "completed" || run.conclusion !== "success") {
  die(`CI on ${head.slice(0, 7)} is ${run ? `${run.status}/${run.conclusion ?? "pending"}` : "missing"}. Wait for green CI.`);
}

if (dryRun) {
  console.log(`release: ${tag} at ${head.slice(0, 7)} is ready (dry run, nothing pushed)`);
  process.exit(0);
}
git("tag", "-a", tag, "-m", `Release ${tag}`);
git("push", "origin", tag);
console.log(`release: pushed ${tag}. Follow the build: gh run watch $(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')`);
