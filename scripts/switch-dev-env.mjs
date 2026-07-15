#!/usr/bin/env node
/**
 * Switch active local env profiles for mobile + API.
 *
 * Profiles (gitignored):
 *   apps/mobile/.env.local | .env.staging  → copied to apps/mobile/.env
 *   .env.local | .env.staging (repo root)  → copied to .env
 *
 * Usage:
 *   node scripts/switch-dev-env.mjs local
 *   node scripts/switch-dev-env.mjs staging
 *   node scripts/switch-dev-env.mjs status
 *   node scripts/switch-dev-env.mjs init   # seed profiles from active .env if missing
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mobileRoot = path.join(repoRoot, "apps", "mobile");

const PROFILES = ["local", "staging"];

const PATHS = {
  mobileActive: path.join(mobileRoot, ".env"),
  rootActive: path.join(repoRoot, ".env"),
  mobileProfile: (name) => path.join(mobileRoot, `.env.${name}`),
  rootProfile: (name) => path.join(repoRoot, `.env.${name}`),
  mobileExample: (name) => path.join(mobileRoot, `.env.${name}.example`),
  rootExample: (name) => path.join(repoRoot, `.env.${name}.example`),
  marker: path.join(repoRoot, ".crewcue-dev-env")
};

function die(message, code = 1) {
  console.error(`switch-dev-env: ${message}`);
  process.exit(code);
}

function readKey(filePath, key) {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = parseEnv(readFileSync(filePath, "utf8"));
    const value = parsed[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function ensureDirFor(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyProfile(src, dest, label) {
  if (!existsSync(src)) {
    die(
      `missing ${label} profile at ${path.relative(repoRoot, src)}\n` +
        `  Create it from the matching *.example, or run: npm run env:init`
    );
  }
  ensureDirFor(dest);
  copyFileSync(src, dest);
  console.log(`switch-dev-env: wrote ${path.relative(repoRoot, dest)} ← ${path.relative(repoRoot, src)}`);
}

function writeMarker(profile) {
  writeFileSync(PATHS.marker, `${profile}\n`, "utf8");
}

function readMarker() {
  if (!existsSync(PATHS.marker)) return undefined;
  const raw = readFileSync(PATHS.marker, "utf8").trim();
  return PROFILES.includes(raw) ? raw : undefined;
}

function printStatus() {
  const marked = readMarker();
  const mobileApi = readKey(PATHS.mobileActive, "EXPO_PUBLIC_API_BASE_URL");
  const mobileAud = readKey(PATHS.mobileActive, "EXPO_PUBLIC_AUTH0_AUDIENCE");
  const mobileDomain = readKey(PATHS.mobileActive, "EXPO_PUBLIC_AUTH0_DOMAIN");
  const apiAud = readKey(PATHS.rootActive, "AUTH0_AUDIENCE");
  const apiIssuer = readKey(PATHS.rootActive, "AUTH0_ISSUER");

  console.log("switch-dev-env: status");
  console.log(`  marker:              ${marked ?? "(none — run env:local or env:staging)"}`);
  console.log(`  mobile API:          ${mobileApi ?? "(missing EXPO_PUBLIC_API_BASE_URL)"}`);
  console.log(`  mobile Auth0 aud:    ${mobileAud ?? "(missing)"}`);
  console.log(`  mobile Auth0 domain: ${mobileDomain ?? "(missing)"}`);
  console.log(`  API AUTH0_AUDIENCE:  ${apiAud ?? "(missing — Auth0 JWT verify disabled)"}`);
  console.log(`  API AUTH0_ISSUER:    ${apiIssuer ?? "(missing — Auth0 JWT verify disabled)"}`);

  if (mobileAud && apiAud && mobileAud !== apiAud) {
    console.log("  WARNING: mobile EXPO_PUBLIC_AUTH0_AUDIENCE !== API AUTH0_AUDIENCE");
  }
  if (mobileDomain && apiIssuer) {
    const expected = `https://${mobileDomain}/`;
    const normalizedIssuer = apiIssuer.endsWith("/") ? apiIssuer : `${apiIssuer}/`;
    if (normalizedIssuer !== expected) {
      console.log(
        `  WARNING: API AUTH0_ISSUER should be ${expected} to match mobile domain (have ${apiIssuer})`
      );
    }
  }

  for (const name of PROFILES) {
    const mobileOk = existsSync(PATHS.mobileProfile(name));
    const rootOk = existsSync(PATHS.rootProfile(name));
    console.log(`  profile ${name}:       mobile=${mobileOk ? "ok" : "MISSING"} api=${rootOk ? "ok" : "MISSING"}`);
  }
}

function seedFromExample(examplePath, destPath) {
  if (existsSync(destPath)) return false;
  if (!existsSync(examplePath)) {
    die(`missing example ${path.relative(repoRoot, examplePath)}`);
  }
  copyFileSync(examplePath, destPath);
  console.log(`switch-dev-env: seeded ${path.relative(repoRoot, destPath)} from example`);
  return true;
}

function patchEnvFile(filePath, updates) {
  let text = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) {
      text = text.replace(re, line);
    } else {
      text = text.endsWith("\n") || text.length === 0 ? `${text}${line}\n` : `${text}\n${line}\n`;
    }
  }
  writeFileSync(filePath, text, "utf8");
}

function initProfiles() {
  // Prefer copying active files when present; otherwise fall back to examples.
  for (const name of PROFILES) {
    if (!existsSync(PATHS.mobileProfile(name))) {
      if (existsSync(PATHS.mobileActive)) {
        copyFileSync(PATHS.mobileActive, PATHS.mobileProfile(name));
        console.log(`switch-dev-env: seeded ${path.relative(repoRoot, PATHS.mobileProfile(name))} from active mobile .env`);
      } else {
        seedFromExample(PATHS.mobileExample(name), PATHS.mobileProfile(name));
      }
    }
    if (!existsSync(PATHS.rootProfile(name))) {
      if (existsSync(PATHS.rootActive)) {
        copyFileSync(PATHS.rootActive, PATHS.rootProfile(name));
        console.log(`switch-dev-env: seeded ${path.relative(repoRoot, PATHS.rootProfile(name))} from active root .env`);
      } else {
        seedFromExample(PATHS.rootExample(name), PATHS.rootProfile(name));
      }
    }
  }

  // Local mobile: point at local API; keep Auth0 keys from whatever was copied.
  const mobileDomain = readKey(PATHS.mobileProfile("local"), "EXPO_PUBLIC_AUTH0_DOMAIN");
  const mobileAud = readKey(PATHS.mobileProfile("local"), "EXPO_PUBLIC_AUTH0_AUDIENCE");
  patchEnvFile(PATHS.mobileProfile("local"), {
    EXPO_PUBLIC_API_BASE_URL: "http://127.0.0.1:4000"
  });

  // Local API: enable Auth0 verify in sync with mobile (reuse staging tenant).
  const localApiUpdates = {};
  if (mobileDomain) {
    localApiUpdates.AUTH0_ISSUER = `https://${mobileDomain}/`;
  }
  if (mobileAud) {
    localApiUpdates.AUTH0_AUDIENCE = mobileAud;
  }
  localApiUpdates.PORT = readKey(PATHS.rootProfile("local"), "PORT") ?? "4000";
  localApiUpdates.HOST = readKey(PATHS.rootProfile("local"), "HOST") ?? "0.0.0.0";
  if (Object.keys(localApiUpdates).length > 0) {
    patchEnvFile(PATHS.rootProfile("local"), localApiUpdates);
    console.log("switch-dev-env: aligned local API AUTH0_* with mobile Auth0 domain/audience");
  }

  // Staging API profile: Auth0 sync if mobile staging has values (Railway still owns deploy env).
  const stagingDomain = readKey(PATHS.mobileProfile("staging"), "EXPO_PUBLIC_AUTH0_DOMAIN");
  const stagingAud = readKey(PATHS.mobileProfile("staging"), "EXPO_PUBLIC_AUTH0_AUDIENCE");
  const stagingApiUpdates = {};
  if (stagingDomain) {
    stagingApiUpdates.AUTH0_ISSUER = `https://${stagingDomain}/`;
  }
  if (stagingAud) {
    stagingApiUpdates.AUTH0_AUDIENCE = stagingAud;
  }
  if (Object.keys(stagingApiUpdates).length > 0) {
    patchEnvFile(PATHS.rootProfile("staging"), stagingApiUpdates);
  }

  console.log("switch-dev-env: init complete. Next: npm run env:local  or  npm run env:staging");
  printStatus();
}

function activate(profile) {
  if (!PROFILES.includes(profile)) {
    die(`unknown profile "${profile}" (use: ${PROFILES.join(", ")}, status, init)`);
  }
  copyProfile(PATHS.mobileProfile(profile), PATHS.mobileActive, `mobile ${profile}`);
  copyProfile(PATHS.rootProfile(profile), PATHS.rootActive, `api ${profile}`);
  writeMarker(profile);
  console.log(`switch-dev-env: active profile → ${profile}`);
  console.log("switch-dev-env: restart Metro / API so new env values load.");
  printStatus();
}

const cmd = process.argv[2]?.trim();
if (!cmd) {
  die("usage: node scripts/switch-dev-env.mjs <local|staging|status|init>");
}

if (cmd === "status") {
  printStatus();
} else if (cmd === "init") {
  initProfiles();
} else {
  activate(cmd);
}
