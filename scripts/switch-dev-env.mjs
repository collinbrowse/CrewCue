#!/usr/bin/env node
/**
 * Switch the active API env profile.
 *
 * Profiles (gitignored): .env.local | .env.staging (repo root) → copied to .env
 *
 * Usage:
 *   node scripts/switch-dev-env.mjs local
 *   node scripts/switch-dev-env.mjs staging
 *   node scripts/switch-dev-env.mjs status
 *   node scripts/switch-dev-env.mjs init   # seed profiles from active .env or *.example if missing
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES = ["local", "staging"];
const PATHS = {
  active: path.join(repoRoot, ".env"),
  profile: (name) => path.join(repoRoot, `.env.${name}`),
  example: (name) => path.join(repoRoot, `.env.${name}.example`),
  marker: path.join(repoRoot, ".crewcue-dev-env")
};

function die(message) {
  console.error(`switch-dev-env: ${message}`);
  process.exit(1);
}

function rel(filePath) {
  return path.relative(repoRoot, filePath);
}

function readKey(filePath, key) {
  if (!existsSync(filePath)) return undefined;
  try {
    const value = parseEnv(readFileSync(filePath, "utf8"))[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function readMarker() {
  if (!existsSync(PATHS.marker)) return undefined;
  const raw = readFileSync(PATHS.marker, "utf8").trim();
  return PROFILES.includes(raw) ? raw : undefined;
}

function printStatus() {
  console.log("switch-dev-env: status");
  console.log(`  marker:          ${readMarker() ?? "(none — run env:local or env:staging)"}`);
  console.log(`  DATABASE_URL:    ${readKey(PATHS.active, "DATABASE_URL") ? "set" : "(missing — use dev:api:memory)"}`);
  console.log(`  AUTH0_ISSUER:    ${readKey(PATHS.active, "AUTH0_ISSUER") ?? "(missing — Auth0 JWT verify disabled)"}`);
  console.log(`  AUTH0_AUDIENCE:  ${readKey(PATHS.active, "AUTH0_AUDIENCE") ?? "(missing — Auth0 JWT verify disabled)"}`);
  for (const name of PROFILES) {
    console.log(`  profile ${name}:   ${existsSync(PATHS.profile(name)) ? "ok" : "MISSING"}`);
  }
}

function initProfiles() {
  for (const name of PROFILES) {
    const dest = PATHS.profile(name);
    if (existsSync(dest)) continue;
    const src = existsSync(PATHS.active) ? PATHS.active : PATHS.example(name);
    if (!existsSync(src)) die(`missing ${rel(src)}`);
    copyFileSync(src, dest);
    console.log(`switch-dev-env: seeded ${rel(dest)} from ${rel(src)}`);
  }
  console.log("switch-dev-env: init complete. Next: npm run env:local  or  npm run env:staging");
  printStatus();
}

function activate(profile) {
  if (!PROFILES.includes(profile)) {
    die(`unknown profile "${profile}" (use: ${PROFILES.join(", ")}, status, init)`);
  }
  const src = PATHS.profile(profile);
  if (!existsSync(src)) die(`missing ${rel(src)}. Run: npm run env:init`);
  copyFileSync(src, PATHS.active);
  writeFileSync(PATHS.marker, `${profile}\n`, "utf8");
  console.log(`switch-dev-env: active profile → ${profile}. Restart the API.`);
  printStatus();
}

const cmd = process.argv[2]?.trim();
if (!cmd) die("usage: node scripts/switch-dev-env.mjs <local|staging|status|init>");
if (cmd === "status") printStatus();
else if (cmd === "init") initProfiles();
else activate(cmd);
