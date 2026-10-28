# Pre-launch repo hygiene

Open items carried over from the 2026-10-17 PR queue triage. Each was checked against `main` on 2026-10-27. Delete this file once all three are done.

- [x] **Dependabot PRs never run CI.** Fixed: the guard now skips Dependabot PRs. Their bodies lack the PR template sections, so `pr-decision-doc-guard` fails and `checks` (lint, typecheck, tests, build) never runs. Proposed fix: in `.github/workflows/ci.yml`, skip the guard when `github.event.pull_request.user.login == 'dependabot[bot]'`. The other option is filling the template by hand on every Dependabot PR, but Dependabot rewrites its body on each rebase.
- [ ] **Pin Node.** `package.json` has `engines: >=20`, CI runs Node 20 (end of life since April 2026), and Railway picks its own version. Pick one LTS (24 or 26) for CI, `engines`/`.nvmrc`, and Railway, then update `@types/node` to match.
- [ ] **Clean up the stale PR queue (21 open).** Many are old `cursor/*` API-fix and test-only drafts that would each need a rebase and fresh CI. Merge or close each one. #512 (room runtime lock) has newer local work saved on branch `wip/512-room-runtime-lock`, which still contains a debug `NOLOCK` branch to remove.

The ping-forgery item from the triage is already fixed by #347.
