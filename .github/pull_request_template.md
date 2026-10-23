## Scope

<!-- What this PR changes and why, in 2–5 sentences. One platform per PR for native UI work. -->

Closes #
<!-- Or: `No issue: <reason>` for hygiene/tooling PRs. Closes/Fixes/Resolves auto-closes on merge. -->

## Decision Tree and Rationale

<!-- CI `pr-decision-doc-guard` requires these three headers with a filled same-line bullet.
     `- Decision: Single obvious path` and `- Assumption/Summary: None identified` are valid values. -->

- Decision:
  - Alternatives considered:
  - Why selected:

## Implicit Assumptions and Invariants

- Assumption:
  - What would break if false:

## Higher-Order Effects Check

<!-- Adjacent modules, retries, authz, persistence, observability, operator workflow, docs/runbooks. -->

- Summary:

## Edge-case proofs

<!-- One line per acceptance criterion or edge case: `- EC1: <criterion> — <test name / command / screenshot>` -->

- EC1:

## Device evidence

<!-- Required when apps/ios or apps/android changed. CI runs the deeplink UI smoke tests; tick a box only after you ran it.
     Attach screenshots in the PR, do not commit them. -->

- [ ] `npm run test:ios` passes; `npm run agent:ios:ready -- --deeplink crewcue://dev/<id>` screenshot attached
- [ ] `npm run test:android` passes; `npm run agent:android:ready -- --deeplink crewcue://dev/<id>` screenshot attached
- Blocker:

## Test plan

- [ ] `npm run verify`
- [ ] Scoped: `verify:api` / `verify:contracts` / `verify:ios` / `verify:android` / `test:pg`

## Risk and rollback

- Risk: low / medium / high
- Rollback:

## Handoff delta

<!-- Agent PRs: ≤5 lines of state a successor needs. Do not edit docs/sdlc/agent-handoff.md mid-wave. -->
