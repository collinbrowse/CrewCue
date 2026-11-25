#!/usr/bin/env node
/**
 * node scripts/ios-resolve-packages.mjs <repoRoot> <packagesDir>
 *
 * Resolves the iOS app's Swift packages into <packagesDir>. Run it through
 * scripts/lib/iosBuild.mjs prepareSharedPackages, which holds the folder's lock.
 * A new folder starts as an APFS clone of the newest sibling (or of the older flat layout),
 * so a changed Package.resolved fetches only what changed and costs no extra disk until then.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [repoRoot, dir] = process.argv.slice(2);
if (!repoRoot || !dir) {
  console.error("usage: ios-resolve-packages.mjs <repoRoot> <packagesDir>");
  process.exit(2);
}
const STATE = "workspace-state.json";
const ENTRIES = ["artifacts", "checkouts", "repositories", STATE];

function seed() {
  if (fs.existsSync(path.join(dir, STATE))) return;
  const base = path.dirname(dir);
  const siblings = fs
    .readdirSync(base)
    .filter((name) => /^[0-9a-f]{16}$/.test(name) && name !== path.basename(dir) && fs.existsSync(path.join(base, name, STATE)))
    .map((name) => ({ from: path.join(base, name), at: fs.statSync(path.join(base, name, STATE)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const from = siblings[0]?.from ?? (fs.existsSync(path.join(base, STATE)) ? base : undefined);
  if (!from) return;
  fs.rmSync(dir, { recursive: true, force: true }); // a half-made folder from an interrupted run
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of ENTRIES) {
    const source = path.join(from, entry);
    if (!fs.existsSync(source)) continue;
    // -c: APFS clone (copy-on-write). If it fails, resolution below clones from the network instead.
    const copied = spawnSync("cp", ["-cR", source, path.join(dir, entry)], { stdio: "ignore" });
    if (copied.status !== 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
  }
  console.error(`ios-resolve-packages: seeded ${dir} from ${from}`);
}

/*
 * workspace-state.json records binary artifacts (xcframeworks) by absolute path. A folder seeded
 * from another one, or an older cache copied out of a worktree, points them at a folder that may
 * be gone, and a build that skips resolution then fails with "There is no XCFramework found".
 * Point every artifact back into this folder when the file is there.
 */
function repointArtifacts() {
  const file = path.join(dir, STATE);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  let changed = 0;
  for (const artifact of state.object?.artifacts ?? []) {
    const at = typeof artifact.path === "string" ? artifact.path.lastIndexOf("/artifacts/") : -1;
    if (at < 0) continue;
    const local = path.join(dir, artifact.path.slice(at + 1));
    if (local !== artifact.path && fs.existsSync(local)) {
      artifact.path = local;
      changed += 1;
    }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

seed();
repointArtifacts();
const result = spawnSync(
  "xcodebuild",
  ["-resolvePackageDependencies", "-project", "apps/ios/CrewCue.xcodeproj", "-scheme", "CrewCue", "-clonedSourcePackagesDirPath", dir],
  { cwd: repoRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
);
if (result.status !== 0) {
  process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  process.exit(result.status ?? 1);
}
repointArtifacts();
console.error(`ios-resolve-packages: resolved ${dir}`);
