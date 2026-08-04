import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceScript = path.join(__dirname, "switch-dev-env.mjs");

function createFixtureRepo(t) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "crewcue-switch-env-"));
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  mkdirSync(path.join(repoRoot, "apps", "mobile"), { recursive: true });
  copyFileSync(sourceScript, path.join(repoRoot, "scripts", "switch-dev-env.mjs"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  return repoRoot;
}

function writeFixture(repoRoot, relativePath, content) {
  const filePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function readFixture(repoRoot, relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function runSwitch(repoRoot, ...args) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", "switch-dev-env.mjs"), ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

test("init seeds missing profiles from examples and aligns API Auth0 values", (t) => {
  const repoRoot = createFixtureRepo(t);

  writeFixture(
    repoRoot,
    "apps/mobile/.env.local.example",
    [
      "EXPO_PUBLIC_AUTH0_DOMAIN=local-auth.example.com",
      "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.local.example",
      "EXPO_PUBLIC_API_BASE_URL=https://stale.example.com"
    ].join("\n")
  );
  writeFixture(
    repoRoot,
    "apps/mobile/.env.staging.example",
    [
      "EXPO_PUBLIC_AUTH0_DOMAIN=staging-auth.example.com",
      "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.staging.example",
      "EXPO_PUBLIC_API_BASE_URL=https://api.staging.example.com"
    ].join("\n")
  );
  writeFixture(repoRoot, ".env.local.example", ["PORT=5050", "HOST=127.0.0.1"].join("\n"));
  writeFixture(repoRoot, ".env.staging.example", "PORT=6060\n");

  const result = runSwitch(repoRoot, "init");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /init complete/);
  assert.match(result.stdout, /aligned local API AUTH0_\* with mobile Auth0 domain\/audience/);

  assert.match(readFixture(repoRoot, "apps/mobile/.env.local"), /^EXPO_PUBLIC_API_BASE_URL=http:\/\/127\.0\.0\.1:4000$/m);
  assert.match(readFixture(repoRoot, ".env.local"), /^AUTH0_ISSUER=https:\/\/local-auth\.example\.com\/$/m);
  assert.match(readFixture(repoRoot, ".env.local"), /^AUTH0_AUDIENCE=https:\/\/api\.local\.example$/m);
  assert.match(readFixture(repoRoot, ".env.local"), /^PORT=5050$/m);
  assert.match(readFixture(repoRoot, ".env.local"), /^HOST=127\.0\.0\.1$/m);
  assert.match(readFixture(repoRoot, ".env.staging"), /^AUTH0_ISSUER=https:\/\/staging-auth\.example\.com\/$/m);
  assert.match(readFixture(repoRoot, ".env.staging"), /^AUTH0_AUDIENCE=https:\/\/api\.staging\.example$/m);
});

test("activate copies selected profiles, records marker, and warns about Auth0 mismatches", (t) => {
  const repoRoot = createFixtureRepo(t);

  writeFixture(
    repoRoot,
    "apps/mobile/.env.staging",
    [
      "EXPO_PUBLIC_AUTH0_DOMAIN=mobile-auth.example.com",
      "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.mobile.example",
      "EXPO_PUBLIC_API_BASE_URL=https://api.staging.example.com"
    ].join("\n")
  );
  writeFixture(
    repoRoot,
    ".env.staging",
    [
      "AUTH0_ISSUER=https://api-auth.example.com/",
      "AUTH0_AUDIENCE=https://api.server.example",
      "PORT=4000"
    ].join("\n")
  );
  writeFixture(repoRoot, "apps/mobile/.env.local", "EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000\n");
  writeFixture(repoRoot, ".env.local", "PORT=4000\n");

  const result = runSwitch(repoRoot, "staging");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /active profile/);
  assert.match(result.stdout, /WARNING: mobile EXPO_PUBLIC_AUTH0_AUDIENCE !== API AUTH0_AUDIENCE/);
  assert.match(result.stdout, /WARNING: API AUTH0_ISSUER should be https:\/\/mobile-auth\.example\.com\//);
  assert.equal(readFixture(repoRoot, ".crewcue-dev-env"), "staging\n");
  assert.equal(readFixture(repoRoot, "apps/mobile/.env"), readFixture(repoRoot, "apps/mobile/.env.staging"));
  assert.equal(readFixture(repoRoot, ".env"), readFixture(repoRoot, ".env.staging"));
});

test("unknown profiles fail before writing an active marker", (t) => {
  const repoRoot = createFixtureRepo(t);

  const result = runSwitch(repoRoot, "production");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown profile "production"/);
  assert.throws(() => readFixture(repoRoot, ".crewcue-dev-env"), /ENOENT/);
});
