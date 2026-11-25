#!/usr/bin/env node
/**
 * npm run test:pg
 *
 * DATABASE_URL set by the caller (CI, test:pg:fresh, by hand): runs the Postgres suite against it.
 * Unset: uses this checkout's own database, `crewcue_test_<worktree>`, on PG_URL_BASE
 * (default postgres://crewcue:crewcue@localhost:5432). It is created on first use and migrated
 * every run, so parallel worktrees never share rows.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "../..");

/** Postgres-safe database name for a checkout (letters, digits, underscores; at most 63 bytes). */
export function worktreeDatabaseName(root) {
  const key = path.basename(path.resolve(root)).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "main";
  return `crewcue_test_${key}`.slice(0, 63);
}

function npm(script, env) {
  const result = spawnSync("npm", ["run", script], { cwd: apiRoot, stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function ensureDatabase(base, name) {
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  try {
    await admin.connect();
  } catch (error) {
    console.error(`test:pg: cannot reach Postgres (${error.message}). Start it (docker compose -f docker-compose.local.yml up -d) or set DATABASE_URL.`);
    process.exit(1);
  }
  try {
    const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name}"`);
      console.log(`test:pg: created database ${name}`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  const env = { ...process.env };
  if (!env.DATABASE_URL?.trim()) {
    const base = (env.PG_URL_BASE || "postgres://crewcue:crewcue@localhost:5432").replace(/\/+$/, "");
    const name = worktreeDatabaseName(repoRoot);
    await ensureDatabase(base, name);
    env.DATABASE_URL = `${base}/${name}`;
    console.log(`test:pg: using this checkout's database ${name} (set DATABASE_URL to use another)`);
    npm("db:migrate", env);
  }
  npm("test:pg:run", env);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
