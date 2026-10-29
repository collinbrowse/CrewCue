# Critical bug hunt (daily)

Goal: find one bug a real crew or athlete would hit on race day, prove it, and fix it. Label `automation:bug-hunt`.

## Pick a target

1. If the latest scheduled **Staging Automation Smoke** run on `main` failed, that failure is today's target.
2. Otherwise take the next area in this rotation, using the day of the year modulo 6:
   0 API persistence and hydration (`services/api` stores, wipes, cold loads) ·
   1 auth, membership and invites ·
   2 client-core outbox, sessions and offline replay (`packages/client-core`) ·
   3 pings, runner progress and pacing projections ·
   4 chat and push webhooks ·
   5 contracts between API and clients (`packages/contracts`, generated client code).
3. Within the area, prefer code changed in the last 14 days (`git log --since=14.days`).

Critical means data loss, wrong race progress, a crew member seeing or changing what they should not, a
crash, or a stuck state with no recovery. Style, naming and refactors are out of scope.

## Prove it before fixing

1. Write the smallest test that fails on `main` because of the bug. Run it and keep the failing output.
2. Fix the bug with the smallest change that makes that test pass.
3. Run the test again and the scoped verify. Keep both outputs.
4. Try to refute your own finding: could the test be wrong, or the behavior intended (check docs and
   ADRs in `docs/`)? If you cannot rule that out, open nothing.

No reproducible failing test, no PR.

**Races and timing bugs.** Most past finds were overlapping requests (a wipe racing a hydrate, two writes
racing a join). Those tests need a test-only pause point, like the existing `set*DelayForTests` hooks in
`services/api/src/routes/raceRooms.ts`. When the seam does not exist yet, make it the PR's first commit,
with no behavior change, and show the new test failing on that commit. The fix is the second commit.
A test that only fails because it does not compile is not a proof.

**Native app code.** Cloud runs cannot drive the iOS simulator. When the bug lives in `apps/ios` or
`apps/android`, move the decision into `packages/client-core` where a Swift test can prove it, and keep
the app change to wiring. If that is not possible, open nothing and describe the bug in the run's final
message for the owner.

## The PR

Put the red and green runs under **Edge-case proofs** (test name, command, the failing assertion on main,
the pass count after). Under **Scope**, describe the user-visible failure in one or two sentences.
