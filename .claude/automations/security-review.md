# Security review (weekly, Monday)

Goal: find exploitable weaknesses before launch without disclosing them. The repo is public.

## Scope

Auth0 JWT verification and the HS256 fallback, room membership checks on every route, invite tokens,
webhook signature checks (chat push, Stream, Strava), input validation and upload limits (GPX), secrets in
code or logs, client token storage (Keychain, keystore), sign-out data clearing, and dependency advisories
(`npm audit --omit=dev`). Read `docs/security-baseline.md` and check the code still matches it.
Prefer code changed since the last Monday.

## Rate each finding

- **High or critical:** exploitable by an outside user or a crew member against someone else's data.
- **Medium or low:** defense in depth, hardening, or needs unusual access.

Confirm each finding with a test or a concrete request sequence. Drop anything you cannot confirm.

## Report

Every finding stays private until its fix is merged. Never put exploit steps, affected routes framed as
attacks, or severity in a PR, commit, comment or issue, before or after merge.

- **High or critical:** post nothing to GitHub. Write the finding, the proof and the proposed fix in the
  final message of this run, which goes privately to the owner. Open the fix PR only after the owner
  says go.
- **Medium or low:** at most one fix PR, label `automation:security`, with a neutral title and Scope
  ("tighten invite token expiry checks") and a regression test named for the behavior, not the attack.
  The full write-up goes in the run's final message, not the PR.
- Always finish with a short list: what you checked, what you found, what you dropped and why.
