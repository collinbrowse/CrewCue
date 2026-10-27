#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("swift", ["test", "--package-path", path.join(repoRoot, "packages/client-core")], {
  stdio: "inherit"
});
process.exit(result.status ?? 1);
