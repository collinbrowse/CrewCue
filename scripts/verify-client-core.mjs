#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_JOBS, slotAvailable, slotted } from "./lib/slot.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = ["test", "--package-path", path.join(repoRoot, "packages/client-core")];
if (slotAvailable()) args.push("-j", String(BUILD_JOBS));
const job = slotted("swift", args, { label: "CrewCue client-core tests", kind: "swift test" });
const result = spawnSync(job.command, job.args, { stdio: "inherit" });
process.exit(result.status ?? 1);
