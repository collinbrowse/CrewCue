import assert from "node:assert/strict";
import test from "node:test";
import { decide, report } from "./staging-smoke-failure.mjs";

const commit = (sha, files = ["services/api/src/app.ts"]) => ({ sha, subject: `change ${sha}`, files });

test("one new commit without a migration is reverted", () => {
  const verdict = decide({ lastGood: "aaa", suspects: [commit("bbb")] });
  assert.equal(verdict.action, "revert");
  assert.equal(verdict.sha, "bbb");
});

test("a new commit that adds a migration is not reverted", () => {
  const verdict = decide({ lastGood: "aaa", suspects: [commit("bbb", ["services/api/db/migrations/0042_x.sql", "services/api/src/app.ts"])] });
  assert.equal(verdict.action, "issue");
  assert.match(verdict.reason, /migration/);
});

test("several new commits are reported, not reverted", () => {
  const verdict = decide({ lastGood: "aaa", suspects: [commit("ccc"), commit("bbb")] });
  assert.equal(verdict.action, "issue");
  assert.match(verdict.reason, /^2 commits/);
});

test("no new commit points at staging, not the code", () => {
  const verdict = decide({ lastGood: "aaa", suspects: [] });
  assert.equal(verdict.action, "issue");
  assert.match(verdict.reason, /staging itself/);
});

test("with no earlier passing deploy nothing is reverted", () => {
  assert.equal(decide({ lastGood: "", suspects: [] }).action, "issue");
});

test("the report names the deployed commit, the last good one and the suspects", () => {
  const suspects = [commit("ccc1234567"), commit("bbb1234567")];
  const text = report({
    sha: "ccc1234567",
    lastGood: "aaa1234567",
    suspects,
    verdict: decide({ lastGood: "aaa1234567", suspects }),
    runUrl: "https://example.test/run/1",
  });
  assert.match(text, /`ccc1234` was deployed: https:\/\/example\.test\/run\/1/);
  assert.match(text, /Last deploy that passed: `aaa1234`/);
  assert.match(text, /- `bbb1234` change bbb1234567/);
});
