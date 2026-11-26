import assert from "node:assert/strict";
import test from "node:test";
import { buildMessage, decide, describeFailedJobs, escapeSlack, history, statusLine, verdictRuns } from "./ci-main-alert.mjs";

const REPO = "owner/repo";

function run(number, conclusion, extra = {}) {
  return {
    id: number * 10,
    run_number: number,
    conclusion,
    event: "push",
    head_branch: "main",
    head_sha: `${number}`.padStart(7, "a").padEnd(40, "0"),
    html_url: `https://github.com/${REPO}/actions/runs/${number * 10}`,
    created_at: `2026-11-26T12:${String(number).padStart(2, "0")}:00Z`,
    ...extra
  };
}

test("cancelled runs and PR runs are not verdicts on main", () => {
  const runs = [run(5, "success"), run(4, "cancelled"), run(3, "failure", { event: "pull_request" }), run(2, "failure"), run(1, "success", { head_branch: "other" })];
  assert.deepEqual(
    verdictRuns(runs).map((r) => r.run_number),
    [5, 2]
  );
});

test("the first red run after a green one is an alert, with the green run as the base", () => {
  const runs = [run(3, "failure"), run(2, "cancelled"), run(1, "success")];
  const past = history(runs[0], runs);
  assert.equal(decide(runs[0], past), "alert");
  assert.equal(past.lastGreen.run_number, 1);
  assert.equal(past.redStreak, 0);
});

test("the next red runs say still red and count the streak", () => {
  const runs = [run(4, "failure"), run(3, "failure"), run(2, "failure"), run(1, "success")];
  const past = history(runs[0], runs);
  assert.equal(decide(runs[0], past), "still-red");
  assert.equal(past.redStreak, 2);
  assert.match(buildMessage({ kind: "still-red", repo: REPO, run: runs[0], jobs: [{ name: "ios", conclusion: "failure", steps: [] }], past }), /still red, 3 runs in a row.*`ios`/);
});

test("the first green run after red says recovered and since when", () => {
  const runs = [run(4, "success"), run(3, "failure"), run(2, "failure"), run(1, "success")];
  const past = history(runs[0], runs);
  assert.equal(decide(runs[0], past), "recovered");
  const text = buildMessage({ kind: "recovered", repo: REPO, run: runs[0], past });
  assert.match(text, /green again/);
  assert.match(text, /after 2 red runs since 2026-11-26 12:02 UTC/);
});

test("green after green, and a cancelled run, say nothing", () => {
  const runs = [run(3, "success"), run(2, "success"), run(1, "failure")];
  assert.equal(decide(runs[0], history(runs[0], runs)), "none");
  const cancelled = run(4, "cancelled");
  assert.equal(decide(cancelled, history(cancelled, runs)), "none");
});

test("a red run with no history is still an alert", () => {
  const only = run(1, "failure");
  const past = history(only, [only]);
  assert.equal(decide(only, past), "alert");
  assert.match(buildMessage({ kind: "alert", repo: REPO, run: only, past }), /No green run found/);
});

test("the alert names the failed step, a job no runner started, and the commits since green", () => {
  const runs = [run(2, "failure"), run(1, "success")];
  const past = history(runs[0], runs);
  const jobs = [
    { name: "checks", conclusion: "success", steps: [] },
    { name: "android", conclusion: "failure", steps: [{ name: "Build", conclusion: "success" }, { name: "Run deeplink smoke tests", conclusion: "failure" }] },
    { name: "ios", conclusion: "cancelled", steps: [] }
  ];
  const commits = Array.from({ length: 10 }, (_, i) => ({ sha: `${i}`.repeat(40), commit: { message: `change ${i}\n\nbody` } }));
  const text = buildMessage({ kind: "alert", repo: REPO, run: runs[0], jobs, past, commits });
  assert.match(text, /`android` \(Run deeplink smoke tests\), `ios` \(no runner started it\)/);
  assert.match(text, /10 commits/);
  assert.match(text, /• <https:\/\/github\.com\/owner\/repo\/commit\/0{40}\|0000000> change 0\n/);
  assert.match(text, /and 2 more/);
  assert.doesNotMatch(text, /body/);
  assert.deepEqual(describeFailedJobs([{ name: "ios", conclusion: "timed_out", steps: [] }]), ["`ios` (timed out)"]);
});

test("commit titles cannot inject Slack markup", () => {
  assert.equal(escapeSlack("<!channel> a & b"), "&lt;!channel&gt; a &amp; b");
  const runs = [run(2, "failure"), run(1, "success")];
  const text = buildMessage({
    kind: "alert",
    repo: REPO,
    run: runs[0],
    past: history(runs[0], runs),
    commits: [{ sha: "c".repeat(40), commit: { message: "<!channel> <https://evil.example|click>" } }]
  });
  assert.doesNotMatch(text, /<!channel>/);
  assert.doesNotMatch(text, /<https:\/\/evil/);
});

test("replays are marked", () => {
  const runs = [run(2, "failure"), run(1, "success")];
  assert.match(buildMessage({ kind: "alert", repo: REPO, run: runs[0], past: history(runs[0], runs), replay: true }), /^\[replay\] /);
});

test("status says green, or red with the last green commit", () => {
  assert.match(statusLine([run(2, "success"), run(1, "failure")], REPO), /^main is green at /);
  assert.match(statusLine([run(3, "cancelled"), run(2, "failure"), run(1, "success")], REPO), /^main is RED at .*last green at aaaaaa1/);
  assert.equal(statusLine([], REPO), "main: no finished CI run found");
});
