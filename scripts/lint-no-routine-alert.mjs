import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const mobileSrc = cwd.endsWith(`${path.sep}apps${path.sep}mobile`)
  ? path.join(cwd, "src")
  : path.join(cwd, "apps/mobile/src");
const repoRoot = cwd.endsWith(`${path.sep}apps${path.sep}mobile`) ? path.join(cwd, "../..") : cwd;

/** Files allowed to call Alert.alert (blocking confirm / permission flows). */
const allowlist = new Set([
  path.join(mobileSrc, "navigation/ProfileHomeScreen.tsx"),
  path.join(mobileSrc, "navigation/TrackMapDashboardScreen.tsx"),
  path.join(mobileSrc, "navigation/ChatNotificationPrefsScreen.tsx")
]);

const ignoredSuffixes = [".test.ts", ".test.tsx"];
const ignoredDirs = new Set(["node_modules"]);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

function isAllowed(filePath) {
  if (allowlist.has(filePath)) {
    return true;
  }
  const rel = path.relative(mobileSrc, filePath);
  if (ignoredSuffixes.some((s) => rel.endsWith(s))) {
    return true;
  }
  return false;
}

const files = await listFiles(mobileSrc);
const violations = [];

for (const file of files) {
  if (isAllowed(file)) {
    continue;
  }
  const content = await readFile(file, "utf8");
  if (/\bAlert\.alert\s*\(/.test(content)) {
    violations.push(path.relative(repoRoot, file));
  }
}

if (violations.length > 0) {
  console.error("Routine Alert.alert is not allowed. Use NoticeBus or allowlist in scripts/lint-no-routine-alert.mjs:\n");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log("lint-no-routine-alert: ok");
