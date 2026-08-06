import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScript = new URL("./switch-dev-env.mjs", import.meta.url);

function makeFixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "crewcue-env-switch-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "apps", "mobile"), { recursive: true });
  copyFileSync(sourceScript, path.join(root, "scripts", "switch-dev-env.mjs"));
  return root;
}

function writeEnv(root, relativePath, lines) {
  writeFileSync(path.join(root, relativePath), `${lines.join("\n")}\n`, "utf8");
}

function readEnv(root, relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function runSwitch(root, command) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "switch-dev-env.mjs"), command], {
    cwd: root,
    encoding: "utf8"
  });
}

test("init seeds missing profiles from examples and aligns Auth0 settings", (t) => {
  const root = makeFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeEnv(root, "apps/mobile/.env.local.example", [
    "EXPO_PUBLIC_AUTH0_DOMAIN=dev-local.example.auth0.com",
    "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.crewcue.local",
    "EXPO_PUBLIC_API_BASE_URL=https://wrong.local"
  ]);
  writeEnv(root, "apps/mobile/.env.staging.example", [
    "EXPO_PUBLIC_AUTH0_DOMAIN=dev-staging.example.auth0.com",
    "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.crewcue.staging",
    "EXPO_PUBLIC_API_BASE_URL=https://staging.example"
  ]);
  writeEnv(root, ".env.local.example", ["PORT=9999", "HOST=127.0.0.1"]);
  writeEnv(root, ".env.staging.example", ["AUTH0_ISSUER=https://old.example/", "AUTH0_AUDIENCE=old"]);

  const result = runSwitch(root, "init");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /init complete/);
  assert.match(readEnv(root, "apps/mobile/.env.local"), /EXPO_PUBLIC_API_BASE_URL=http:\/\/127\.0\.0\.1:4000/);
  assert.match(readEnv(root, ".env.local"), /AUTH0_ISSUER=https:\/\/dev-local\.example\.auth0\.com\//);
  assert.match(readEnv(root, ".env.local"), /AUTH0_AUDIENCE=https:\/\/api\.crewcue\.local/);
  assert.match(readEnv(root, ".env.local"), /PORT=9999/);
  assert.match(readEnv(root, ".env.staging"), /AUTH0_ISSUER=https:\/\/dev-staging\.example\.auth0\.com\//);
  assert.match(readEnv(root, ".env.staging"), /AUTH0_AUDIENCE=https:\/\/api\.crewcue\.staging/);
});

test("staging activation copies both profiles, writes marker, and reports healthy status", (t) => {
  const root = makeFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeEnv(root, "apps/mobile/.env.staging", [
    "EXPO_PUBLIC_AUTH0_DOMAIN=dev-staging.example.auth0.com",
    "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.crewcue.staging",
    "EXPO_PUBLIC_API_BASE_URL=https://staging.example"
  ]);
  writeEnv(root, ".env.staging", [
    "AUTH0_ISSUER=https://dev-staging.example.auth0.com/",
    "AUTH0_AUDIENCE=https://api.crewcue.staging"
  ]);
  writeEnv(root, "apps/mobile/.env.local", ["EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000"]);
  writeEnv(root, ".env.local", ["PORT=4000"]);

  const result = runSwitch(root, "staging");

  assert.equal(result.status, 0, result.stderr);
  assert.match(readEnv(root, "apps/mobile/.env"), /EXPO_PUBLIC_API_BASE_URL=https:\/\/staging\.example/);
  assert.match(readEnv(root, ".env"), /AUTH0_AUDIENCE=https:\/\/api\.crewcue\.staging/);
  assert.equal(readEnv(root, ".crewcue-dev-env"), "staging\n");
  assert.match(result.stdout, /marker:\s+staging/);
  assert.doesNotMatch(result.stdout, /WARNING:/);
});

test("status warns when mobile and API Auth0 values drift", (t) => {
  const root = makeFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeEnv(root, "apps/mobile/.env", [
    "EXPO_PUBLIC_AUTH0_DOMAIN=mobile.example.auth0.com",
    "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.mobile"
  ]);
  writeEnv(root, ".env", [
    "AUTH0_ISSUER=https://api.example.auth0.com/",
    "AUTH0_AUDIENCE=https://api.server"
  ]);

  const result = runSwitch(root, "status");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WARNING: mobile EXPO_PUBLIC_AUTH0_AUDIENCE !== API AUTH0_AUDIENCE/);
  assert.match(
    result.stdout,
    /WARNING: API AUTH0_ISSUER should be https:\/\/mobile\.example\.auth0\.com\/ to match mobile domain/
  );
});

test("unknown profile exits without mutating active env files", (t) => {
  const root = makeFixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeEnv(root, ".env", ["EXISTING=1"]);
  writeEnv(root, "apps/mobile/.env", ["EXISTING_MOBILE=1"]);

  const result = runSwitch(root, "production");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown profile "production"/);
  assert.equal(readEnv(root, ".env"), "EXISTING=1\n");
  assert.equal(readEnv(root, "apps/mobile/.env"), "EXISTING_MOBILE=1\n");
});
