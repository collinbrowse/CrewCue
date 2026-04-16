# GitHub issues and pull requests (task workflow)

This is the default way **CrewCue** ties local work to GitHub: every scoped task has an **issue**, every implementation ships in a **pull request**, and a **merged** PR closes the issue automatically.

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

## Summary checklist

| Step | Done when |
| --- | --- |
| Issue | GitHub issue exists with objective + acceptance. |
| Branch | Feature branch pushed (not implementing on `main`). |
| PR | PR targets `main`, body includes `Closes #<issue>`. |
| Merge | CI green, review done, squash/merge per team preference. |
| Close | Issue closed automatically after merge. |
