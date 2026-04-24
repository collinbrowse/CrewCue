# GitHub issues and pull requests (task workflow)

This is the default way **CrewCue** ties local work to GitHub: every scoped task has an **issue**, every implementation ships in a **pull request**, and a **merged** PR closes the issue automatically.

## GitHub as the visible task board (sprints, status, links)

You can treat **GitHub as the full tracker** for what is planned, in progress, and done—without replacing the long-form plans in the repo (those stay the “why and what” narrative).

| Piece | What it is for (plain language) |
| --- | --- |
| **Issues** | One card per task; scope and acceptance live here (same as today). |
| **Pull requests** | The actual code change; link to the issue so merge **closes** the task (see below). |
| **GitHub Projects** | A **board or table** of issues: columns like *Backlog / Ready / In progress / Done*, filters by label (e.g. `ws3`), and optional **dates** so you see the whole workstream at a glance. |
| **Iterations** (in Projects) | **Sprint-style timeboxes** (e.g. “WS3 Sprint 1 — two weeks”): assign each issue to an iteration to answer “what are we shipping this sprint?” |
| **Milestones** (optional) | Another way to group issues by release or sprint if you prefer not to use Project iterations; some teams use both. |
| **Labels** | Quick tags: `workstream-task`, `ws3`, `blocked`, `docs`, etc., so views stay readable. |
| **Parent / sub-issues** | Optional: one **epic** issue for “WS3 first sprint” with **child issues** per task, so status rolls up visually. |

**Links you care about:** PR bodies already support `Closes #123`. Issues can link to other issues or PRs with `#number` or full URLs. Project views simply **pull in those same issues**, so status, sprint, and code stay connected.

**Suggested split:** keep **sign-off and deep sequencing** in `docs/sdlc/` (like WS2), and use **GitHub for live status**—every sprint gets a **Milestone or Project iteration** plus a short **tracking issue** that lists child issue numbers and links to the execution doc when you add one.

## 1. Create a GitHub issue first

When you (or the agent) start a **new task**—a slice of work with clear acceptance criteria—**open an issue before writing implementation code**.

- Prefer the **Workstream Task** template: *New issue* → **Workstream Task** ([`../../.github/ISSUE_TEMPLATE/ws-task.yml`](../../.github/ISSUE_TEMPLATE/ws-task.yml)).
- Title pattern: `[WSx] Short description` (or `[Repo]` for cross-cutting work).
- The issue is the **single source of truth** for scope and acceptance.

CLI example:

```bash
gh issue create --label workstream-task --title "[WS2] Task 3 projection staleness" --body "$(cat <<'EOF'
## Objective
…
EOF
)"
```

Note the issue number from the URL (e.g. `#9`).

## 2. Branch from `main` (no direct pushes for feature work)

```bash
git checkout main && git pull origin main
git checkout -b feature/ws2-task3-projection-staleness
```

Use a branch name that matches the issue when helpful (not required by Git).

## 3. Open a pull request

- Push the branch: `git push -u origin <branch>`.
- Open a PR against **`main`** (use `gh pr create` or the GitHub UI).
- Complete all required PR template sections, including:
  - Decision tree and rationale
  - Implicit assumptions and invariants
  - Higher-order effects check (or explicit "None identified")

## 4. Link the PR to the issue (required for auto-close)

GitHub (and this repo’s automation) closes issues when the **PR description** contains a **closing keyword** and the issue number:

| Keyword | Example |
| --- | --- |
| `Closes` | `Closes #9` |
| `Fixes` | `Fixes #9` |
| `Resolves` | `Resolves #9` |

Put this in the **PR body** (not only the title). Plural forms (`Close`, `Fix`, `Resolve`) also work.

This repository runs [`.github/workflows/auto-close-linked-issues.yml`](../../.github/workflows/auto-close-linked-issues.yml) when a PR is **merged**: it parses the merged PR’s body for those patterns and **closes** the listed issues, adding a short comment.

**Tip:** Copy the **Linked issues** line from [`.github/pull_request_template.md`](../../.github/pull_request_template.md) and fill in the number before opening the PR.

## 5. Merge

When the PR is merged into `default` (`main`), linked issues should move to **Closed**. If something did not close, check that the PR body still contains e.g. `Closes #123` (workflow only inspects the **description**, not arbitrary comments).

## 6. Branch protection for dual-client safety (recommended)

To prevent regressions while we prepare for separate mobile + web apps, require CI status checks on `main`.

GitHub UI path:

1. Repository -> **Settings** -> **Branches**
2. Under **Branch protection rules**, add or edit rule for `main`
3. Enable **Require a pull request before merging**
4. Enable **Require status checks to pass before merging**
5. Add required checks from CI:
   - `dual-client-guard`
   - `checks`
   - `api-postgres-integration`
6. Save rule

Why this matters:

- `dual-client-guard` fails if raw networking drifts outside `apps/mobile/src/api/client.ts`
- `checks` covers lint/typecheck/build/tests
- `api-postgres-integration` protects Postgres-backed API behavior

## Summary checklist

| Step | Done when |
| --- | --- |
| Issue | GitHub issue exists with objective + acceptance. |
| Branch | Feature branch pushed (not implementing on `main`). |
| PR | PR targets `main`, body includes `Closes #<issue>` and required decision-rationale sections. |
| Merge | CI green, review done, squash/merge per team preference. |
| Close | Issue closed automatically after merge. |
| Protection | `main` requires `dual-client-guard`, `checks`, and `api-postgres-integration`. |

## See also

- **[Codebase maintainability standard](./codebase-maintainability-standard.md)** — required structure/comment/duplication expectations for PR quality.
- **[SDLC docs map](./README.md)** — active docs vs archive doc.
