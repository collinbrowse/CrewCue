// Runs scripts/staging-smoke-stoppage.sh against a local API (memory mode, dev JWT) and a stand-in
// Auth0 token endpoint, so the smoke's own room bookkeeping can be tested without staging.
// Needs the API built (`npm run build -w @crewcue/api`), plus bash, curl, jq and python3; skips otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const smokeScript = join(repoRoot, "scripts/staging-smoke-stoppage.sh");
const apiEntry = join(repoRoot, "services/api/dist/services/api/src/server.js");
const DEV_JWT_SECRET = "dev-only-secret";
const AUTOMATION_SUB = "auth0|staging-smoke-automation";

const missing = ["bash", "curl", "jq", "python3"].filter(
  (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status !== 0
);
const skip = !existsSync(apiEntry)
  ? "API not built (npm run build -w @crewcue/api)"
  : missing.length > 0
    ? `missing ${missing.join(", ")}`
    : false;

function signDevJwt(payload) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iat: Math.floor(Date.now() / 1000), ...payload })}`;
  return `${unsigned}.${createHmac("sha256", DEV_JWT_SECRET).update(unsigned).digest("base64url")}`;
}

const accessToken = signDevJwt({ sub: AUTOMATION_SUB, teamIds: ["team-1"], roomRoles: {} });

async function startTokenEndpoint() {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: accessToken, token_type: "Bearer" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function startApi() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", PERSISTENCE_MODE: "memory", NODE_ENV: "test" };
  for (const key of ["AUTH0_ISSUER", "AUTH0_AUDIENCE", "DATABASE_URL", "JWT_SECRET"]) delete env[key];
  const child = spawn(process.execPath, [apiEntry], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/health/live`)).ok) return { child, base };
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`API did not start: ${stderr}`);
}

async function api(base, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID()
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

/** A room the smoke created and never got to unlock: a run that failed between Step A and Step B. */
async function leaveUnpaidSmokeRoom(base) {
  const created = await api(base, "POST", "/race-rooms", {
    teamId: "team-1",
    athleteId: AUTOMATION_SUB,
    name: "Stoppage Smoke Room",
    creatorRole: "team_manager"
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id;
}

function runSmoke(apiBase, tokenUrl) {
  return new Promise((resolve) => {
    const child = spawn("bash", [smokeScript], {
      env: {
        ...process.env,
        API_BASE_URL: apiBase,
        AUTH0_ISSUER: tokenUrl,
        AUTH0_AUDIENCE: "https://api.crewcue.test",
        AUTH0_AUTOMATION_CLIENT_ID: "client",
        AUTH0_AUTOMATION_CLIENT_SECRET: "secret",
        AUTH0_AUTOMATION_USER_EMAIL: "automation@example.test",
        AUTH0_AUTOMATION_USER_PASSWORD: "password"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("the staging smoke still runs after earlier failed runs left 3 unpaid smoke rooms", { skip }, async () => {
  const token = await startTokenEndpoint();
  let api0;
  try {
    api0 = await startApi();
    const { base } = api0;
    const leftovers = [];
    for (let i = 0; i < 3; i += 1) leftovers.push(await leaveUnpaidSmokeRoom(base));

    const run = await runSmoke(base, token.url);
    assert.equal(run.code, 0, `smoke failed:\n${run.output}`);

    for (const roomId of leftovers) {
      const room = await api(base, "GET", `/race-rooms/${roomId}`);
      assert.notEqual(room.body?.entitlement?.status, "unpaid", `leftover ${roomId} still counts toward the limit`);
    }
  } finally {
    api0?.child.kill();
    token.server.close();
  }
});
