# Confidence tests (Tue, Thu, Sat)

Goal: add the one test that most raises confidence that Crew Cue works for a real race, not line coverage.
Label `automation:confidence`.

## What counts

In priority order:

1. **Race-day journeys** against the real API on Postgres (`test:pg`): create a room, invite crew, join,
   upload a GPX course, athlete pings, crew reads runner progress, chat, offline outbox replay, sign-out.
   Extend an existing journey test rather than starting a new file when one exists.
2. **Postgres-only paths** that have memory-store tests but no `test:pg` counterpart.
3. **Contract drift:** a request or response shape the clients rely on that no test pins.
4. **Weak tests:** code where a sampled mutation run survives. Run
   `npx stryker run --mutate <one file>` on one recently changed file in `services/api/src` or
   `packages/map-core/src` when Stryker is available, and target a surviving mutant.

## What does not count

- Tests for `scripts/**` agent harness files, unless those files changed in the last 14 days.
- A test that only restates the implementation, or passes with the code under test deleted.
- Anything an open or recently closed automation PR already covers (see README rule 3).

## If a new test fails

Good: that is a bug. Do not loosen the test. Hand it to the bug-hunt rules in `bug-hunt.md`
(prove, fix, label `automation:bug-hunt`) in the same PR.

## The PR

Under **Scope**, name the journey or risk the test now guards in user terms. Under **Edge-case proofs**,
show the test passing, and show it failing when you break the code it guards (then restore it).
