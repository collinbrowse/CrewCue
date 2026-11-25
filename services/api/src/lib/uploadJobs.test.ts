import test from "node:test";
import assert from "node:assert/strict";
import { resetUploadJobsForTests, settleUploadJobsForTests, startUploadJob, uploadJobFor } from "./uploadJobs.js";

const noError = () => ({ status: 500, body: { error: "x" } });

test("a job runs in the background, then holds its result for its owner only", async () => {
  resetUploadJobsForTests();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const id = startUploadJob("a", async () => {
    await gate;
    return { status: 201, body: { saved: 3 } };
  }, noError);
  assert.deepEqual(uploadJobFor("a", id), { state: "running" });
  assert.equal(uploadJobFor("b", id), null);
  release();
  await settleUploadJobsForTests();
  assert.deepEqual(uploadJobFor("a", id), { state: "done", status: 201, body: { saved: 3 } });
});

test("a second upload from the same owner cancels the first at its next yield", async () => {
  resetUploadJobsForTests();
  let yields = 0;
  const first = startUploadJob("a", async ({ yieldNow }) => {
    for (;;) {
      await yieldNow();
      yields += 1;
    }
  }, noError);
  await new Promise((resolve) => setImmediate(resolve));
  const second = startUploadJob("a", async () => ({ status: 200, body: {} }), noError);
  const other = startUploadJob("b", async () => ({ status: 200, body: {} }), noError);
  await settleUploadJobsForTests();
  assert.equal(uploadJobFor("a", first), null);
  assert.equal(uploadJobFor("a", second)?.state, "done");
  assert.equal(uploadJobFor("b", other)?.state, "done");
  assert.ok(yields < 5);
});

test("a thrown error becomes the job's failed result", async () => {
  resetUploadJobsForTests();
  const id = startUploadJob("a", async () => {
    throw new Error("boom");
  }, () => ({ status: 400, body: { code: "file_corrupt" } }));
  await settleUploadJobsForTests();
  assert.deepEqual(uploadJobFor("a", id), { state: "failed", status: 400, body: { code: "file_corrupt" } });
});
