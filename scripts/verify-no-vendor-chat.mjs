#!/usr/bin/env node
/**
 * Crew chat is first-party (ADR 0011). Fails if the Stream Chat vendor comes back into app,
 * client-core, contracts or API source, or into their package manifests.
 * Usage: node scripts/verify-no-vendor-chat.mjs
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = [
  "apps/ios",
  "apps/android",
  "packages/client-core",
  "packages/contracts/src",
  "services/api/src",
  "services/api/package.json",
  "package.json",
  ".env.local.example",
  ".env.staging.example"
];
// Vendor names only: plain words such as InputStream or "event streams" are fine.
const pattern = String.raw`stream-chat|getstream|StreamChat|stream_chat|STREAM_API|streamToken|stream-token|streamUserId|ChatStream`;

let output = "";
try {
  output = execFileSync("git", ["grep", "-n", "-I", "-E", pattern, "--", ...paths], {
    cwd: repoRoot,
    encoding: "utf8"
  });
} catch (error) {
  if (error.status === 1) {
    console.log("verify:no-vendor-chat passed");
    process.exit(0);
  }
  throw error;
}
console.error("Stream Chat references found (crew chat is first-party, ADR 0011):");
console.error(output.trim());
process.exit(1);
