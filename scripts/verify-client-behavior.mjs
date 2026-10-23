#!/usr/bin/env node
/**
 * Behavior checklists are the parity spec.
 * `ios` / `android` may be "pass" only when a device proof file exists.
 * Usage: node scripts/verify-client-behavior.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const behaviorDir = path.join(repoRoot, "clients/behavior");
const proofDir = path.join(repoRoot, ".agent-pr-evidence/behavior");
const required = [
  "Entry",
  "Action",
  "API",
  "Permissions",
  "Success",
  "Empty",
  "Error",
  "Offline",
  "Accessibility labels",
  "Native SDK pocket"
];
const forbidden = ["match the ios screen", "port the compose file", "screenshot diff"];
const allowedSdk = new Set(["none", "maplibre", "stream", "auth0", "location", "push"]);
const allowedStatus = new Set(["pass", "fail", "deferred"]);

function section(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start < 0) return "";
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

function proofOk(id, platform) {
  const file = path.join(proofDir, `${id}.${platform}.json`);
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed.id === id && parsed.platform === platform && typeof parsed.action === "string" && parsed.action.length > 0;
  } catch {
    return false;
  }
}

function main() {
  const errors = [];
  const files = fs.readdirSync(behaviorDir).filter((name) => name.endsWith(".md")).sort();
  if (files.length === 0) {
    errors.push("no checklists in clients/behavior");
  }
  const indexPath = path.join(behaviorDir, "deeplinks.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const byId = new Map((index.features ?? []).map((row) => [row.id, row]));
  const deferred = new Set(index.deferred ?? []);

  for (const id of deferred) {
    if (byId.has(id)) errors.push(`deferred id ${id} must not also be a feature row`);
    if (files.includes(`${id}.md`)) errors.push(`deferred id ${id} must not have a checklist`);
  }

  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    const text = fs.readFileSync(path.join(behaviorDir, file), "utf8");
    const lower = text.toLowerCase();
    for (const phrase of forbidden) {
      if (lower.includes(phrase)) errors.push(`${file} contains forbidden phrase: ${phrase}`);
    }
    for (const name of required) {
      if (!section(text, name)) errors.push(`${file} missing ${name}`);
    }
    const entry = section(text, "Entry").split("\n")[0]?.trim();
    const label = section(text, "Accessibility labels").match(/crewcue\.[a-z0-9.-]+/)?.[0];
    const sdk = section(text, "Native SDK pocket").split("\n")[0]?.trim();
    const row = byId.get(id);
    if (!row) errors.push(`${file} missing from deeplinks.json`);
    if (row && entry && row.entry !== entry) errors.push(`${file} entry ${entry} != ${row.entry}`);
    if (row && label && row.label !== label) errors.push(`${file} label ${label} != ${row.label}`);
    if (sdk && !allowedSdk.has(sdk)) errors.push(`${file} sdk ${sdk} is not allowed`);
    if (entry && !entry.startsWith("crewcue://dev/")) errors.push(`${file} entry must be a dev deeplink`);
    if (row) {
      for (const platform of ["ios", "android"]) {
        const status = row[platform];
        if (!allowedStatus.has(status)) errors.push(`${id} ${platform} status ${status} is not allowed`);
        if (status === "pass" && !proofOk(id, platform)) {
          errors.push(`${id} ${platform} pass without .agent-pr-evidence/behavior/${id}.${platform}.json`);
        }
        if (status === "deferred") errors.push(`${id} is a feature row and cannot be deferred; move it to deeplinks.deferred`);
      }
    }
  }

  for (const row of index.features ?? []) {
    if (!files.includes(`${row.id}.md`)) errors.push(`deeplinks.json id ${row.id} has no checklist`);
  }

  if (errors.length) {
    console.error("verify:client-behavior failed");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`verify:client-behavior passed (${files.length} checklists, ${deferred.size} deferred)`);
}

main();
