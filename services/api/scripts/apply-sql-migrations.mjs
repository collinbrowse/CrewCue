#!/usr/bin/env node
/**
 * Applies SQL files in services/api/db/migrations in lexical order.
 * Requires DATABASE_URL. Safe to re-run: migrations use IF NOT EXISTS / idempotent DDL.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("apply-sql-migrations: DATABASE_URL is not set.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "db", "migrations");

const pool = new Pool({ connectionString });

try {
  const names = (await fs.readdir(migrationsDir))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  if (names.length === 0) {
    console.error(`apply-sql-migrations: no .sql files in ${migrationsDir}`);
    process.exit(1);
  }
  for (const name of names) {
    const full = path.join(migrationsDir, name);
    const sql = await fs.readFile(full, "utf8");
    process.stdout.write(`apply-sql-migrations: applying ${name}...\n`);
    await pool.query(sql);
  }
  process.stdout.write(`apply-sql-migrations: done (${names.length} files).\n`);
} catch (err) {
  console.error("apply-sql-migrations: failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
