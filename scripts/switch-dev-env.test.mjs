import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const switcherPath = path.join(testRoot, "switch-dev-env.mjs");
const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewcue-env-switch-"));
  const scriptDir = path.join(root, "scripts");
  const mobileDir = path.join(root, "apps", "mobile");
  await mkdir(scriptDir, { recursive: true });
  await mkdir(mobileDir, { recursive: true });
  await copyFile(switcherPath, path.join(scriptDir, "switch-dev-env.mjs"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    mobileDir,
    scriptPath: path.join(scriptDir, "switch-dev-env.mjs")
  };
}

function runSwitcher(harness, command) {
  return spawnSync(process.execPath, [harness.scriptPath, command], {
    cwd: harness.root,
    encoding: "utf8"
  });
}

async function writeRelative(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function readRelative(root, relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function existsRelative(root, relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

test("init seeds missing profiles from examples and aligns local Auth0 settings", async () => {
  const harness = await createHarness();

  await writeRelative(
    harness.root,
    "apps/mobile/.env.local.example",
    [
      "EXPO_PUBLIC_API_BASE_URL=https://staging.example.test",
      "EXPO_PUBLIC_AUTH0_DOMAIN=crewcue.example.auth0.com",
      "EXPO_PUBLIC_AUTH0_AUDIENCE=https://api.crewcue.test"
    ].join("\n") + "\n"
  );
  await writeRelative(
    harness.root,
    "apps/mobile/.env.staging.example",
    [
      "EXPO_PUBLIC_API_BASE_URL=https://staging.example.test",
      "EXPO_PUBLIC_AUTH0_DOMAIN=staging.example.auth0.com",
      "EXPO_PUBLIC_AUTH0_AUDIENCE=https://staging-api.crewcue.test"
    ].join("\n") + "\n"
  );
  await writeRelative(harness.root, ".env.local.example", "PORT=9000\n");
  await writeRelative(harness.root, ".env.staging.example", "HOST=127.0.0.1\n");

  const result = runSwitcher(harness, "init");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /aligned local API AUTH0_\* with mobile Auth0 domain\/audience/);

  const mobileLocal = await readRelative(harness.root, "apps/mobile/.env.local");
  assert.match(mobileLocal, /^EXPO_PUBLIC_API_BASE_URL=http:\/\/127\.0\.0\.1:4000$/m);
  assert.match(mobileLocal, /^EXPO_PUBLIC_AUTH0_DOMAIN=crewcue\.example\.auth0\.com$/m);
  assert.match(mobileLocal, /^EXPO_PUBLIC_AUTH0_AUDIENCE=https:\/\/api\.crewcue\.test$/m);

  const rootLocal = await readRelative(harness.root, ".env.local");
  assert.match(rootLocal, /^PORT=9000$/m);
  assert.match(rootLocal, /^HOST=0\.0\.0\.0$/m);
  assert.match(rootLocal, /^AUTH0_ISSUER=https:\/\/crewcue\.example\.auth0\.com\/$/m);
  assert.match(rootLocal, /^AUTH0_AUDIENCE=https:\/\/api\.crewcue\.test$/m);

  const rootStaging = await readRelative(harness.root, ".env.staging");
  assert.match(rootStaging, /^HOST=127\.0\.0\.1$/m);
  assert.match(rootStaging, /^AUTH0_ISSUER=https:\/\/staging\.example\.auth0\.com\/$/m);
  assert.match(rootStaging, /^AUTH0_AUDIENCE=https:\/\/staging-api\.crewcue\.test$/m);
});

test("staging activation copies both profile files and writes the marker", async () => {
  const harness = await createHarness();
  const mobileStaging = "EXPO_PUBLIC_API_BASE_URL=https://staging.example.test\n";
  const rootStaging = "PORT=443\nHOST=0.0.0.0\n";
  await writeRelative(harness.root, "apps/mobile/.env.local", "EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000\n");
  await writeRelative(harness.root, ".env.local", "PORT=4000\n");
  await writeRelative(harness.root, "apps/mobile/.env.staging", mobileStaging);
  await writeRelative(harness.root, ".env.staging", rootStaging);

  const result = runSwitcher(harness, "staging");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readRelative(harness.root, "apps/mobile/.env"), mobileStaging);
  assert.equal(await readRelative(harness.root, ".env"), rootStaging);
  assert.equal(await readRelative(harness.root, ".crewcue-dev-env"), "staging\n");
  assert.match(result.stdout, /active profile .* staging/);
});

test("status warns when mobile and API Auth0 settings drift", async () => {
  const harness = await createHarness();
  await writeRelative(
    harness.root,
    "apps/mobile/.env",
    [
      "EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000",
      "EXPO_PUBLIC_AUTH0_DOMAIN=mobile.example.auth0.com",
      "EXPO_PUBLIC_AUTH0_AUDIENCE=https://mobile-api.crewcue.test"
    ].join("\n") + "\n"
  );
  await writeRelative(
    harness.root,
    ".env",
    [
      "AUTH0_ISSUER=https://other.example.auth0.com/",
      "AUTH0_AUDIENCE=https://other-api.crewcue.test"
    ].join("\n") + "\n"
  );

  const result = runSwitcher(harness, "status");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WARNING: mobile EXPO_PUBLIC_AUTH0_AUDIENCE !== API AUTH0_AUDIENCE/);
  assert.match(
    result.stdout,
    /WARNING: API AUTH0_ISSUER should be https:\/\/mobile\.example\.auth0\.com\/ to match mobile domain/
  );
});

test("unknown profiles fail before mutating active env files", async () => {
  const harness = await createHarness();

  const result = runSwitcher(harness, "preview");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown profile "preview"/);
  assert.equal(await existsRelative(harness.root, "apps/mobile/.env"), false);
  assert.equal(await existsRelative(harness.root, ".env"), false);
  assert.equal(await existsRelative(harness.root, ".crewcue-dev-env"), false);
});
