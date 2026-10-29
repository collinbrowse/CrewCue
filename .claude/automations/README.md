# Scheduled automations

Claude Code scheduled tasks run these loops in the cloud. Each task's prompt is one line:
`Read and follow .claude/automations/<file> on main.` Change a loop by changing its file in a PR.

| Loop | File | Schedule (UTC) | Output |
| --- | --- | --- | --- |
| Critical bug hunt | `bug-hunt.md` | Daily 06:00 | At most one fix PR, with a failing-then-passing test |
| Confidence tests | `confidence-tests.md` | Tue, Thu, Sat 09:00 | At most one test PR on a real journey or the Postgres path |
| Security review | `security-review.md` | Mon 07:00 | Private report; low and medium fixes as PRs |
| PR verifier | `pr-verifier.md` | Daily 12:00 | A verdict comment on each open automation PR |
| Weekly digest | `weekly-digest.md` | Fri 16:00 | One summary note to the owner |

Deterministic checks run in GitHub Actions instead: `.github/workflows/security.yml` and the scheduled
`.github/workflows/staging-smoke.yml`.

## Rules every loop follows

1. **The repo is public.** PR titles, bodies, commits, comments and issues are public the moment they post.
   Never describe an exploitable high or critical vulnerability in any of them (see `security-review.md`).
2. **Read first.** `AGENTS.md`, then the `.claude/rules/*` files for the trees you touch.
3. **Dedupe before work.** List open PRs and PRs closed in the last 60 days that carry any `automation:*`
   label or a `cursor/*` branch. Skip a finding or test that one of them already covers, merged or not.
   A PR the owner closed unmerged is a "no" for that idea; do not reopen it in new words.
4. **One PR per run, at most.** A run that finds nothing worth a PR opens nothing. That is a good outcome.
5. **Branch and label.** Branch `claude/<loop>-<short-slug>`. Label the PR `automation:<loop>` and open it
   as a draft. The verifier, not the author, marks it ready.
6. **PR body.** A filled `.github/pull_request_template.md`. `No issue: found by the <loop> automation` is
   the Closes line. Run `npm run agent:pr:done -- --body-file <path>` before opening.
7. **Verify.** Run the scoped `verify:*` for what changed, and `npm run test:pg -w @crewcue/api` when the API
   persistence path is involved (start Postgres from `docker-compose.local.yml` or a local install).
   Report exact pass and fail counts. Never skip, disable or weaken a test to get green.
8. **Native UI.** Cloud runs are Linux with no iOS simulator. Do not change `apps/ios/**` or `apps/android/**`
   UI unless CI's device smoke jobs cover the change; say so under Device evidence.
