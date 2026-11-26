import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { areasFor, changedFiles } from "./ci-changed-areas.mjs";

test("docs and API changes need no device job", () => {
  assert.deepEqual(areasFor(["docs/kb/architecture.md", "services/api/src/app.ts", "README.md"]), { ios: false, android: false });
});

test("an app change runs only its own platform", () => {
  assert.deepEqual(areasFor(["apps/ios/CrewCue/App/AppRouter.swift"]), { ios: true, android: false });
  assert.deepEqual(areasFor(["apps/android/app/build.gradle.kts"]), { ios: false, android: true });
});

test("shared client code, the checklists and the workflow run both platforms", () => {
  for (const file of ["packages/client-core/Package.swift", "clients/behavior/deeplinks.json", ".github/workflows/ci.yml", "scripts/ci-changed-areas.mjs"]) {
    assert.deepEqual(areasFor([file]), { ios: true, android: true }, file);
  }
});

test("a platform's own build scripts run that platform", () => {
  assert.deepEqual(areasFor(["scripts/lib/iosBuild.mjs"]), { ios: true, android: false });
  assert.deepEqual(areasFor([".github/actions/setup-swift/action.yml"]), { ios: false, android: true });
});

test("a file that only shares a name prefix does not count", () => {
  assert.deepEqual(areasFor(["apps/ios-notes.md", "scripts/test-ios.mjs.bak"]), { ios: false, android: false });
});

test("unknown changes run everything", () => {
  assert.deepEqual(areasFor(null), { ios: true, android: true });
});

test("changedFiles covers every commit since the base, and is null without a usable base", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ci-areas-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    const commit = (file) => {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      fs.writeFileSync(path.join(repo, file), `${Date.now()}${Math.random()}`);
      git("add", "-A");
      git("commit", "-q", "-m", file);
      return git("rev-parse", "HEAD");
    };
    const green = commit("README.md");
    commit("apps/ios/A.swift");
    commit("docs/kb/x.md");

    // The newest commit is docs only, but an iOS change since the last green run is still untested.
    assert.deepEqual(changedFiles(green, "HEAD", repo).sort(), ["apps/ios/A.swift", "docs/kb/x.md"]);
    assert.deepEqual(areasFor(changedFiles(green, "HEAD", repo)), { ios: true, android: false });
    assert.equal(changedFiles("", "HEAD", repo), null);
    assert.equal(changedFiles("0000000000000000000000000000000000000001", "HEAD", repo), null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
