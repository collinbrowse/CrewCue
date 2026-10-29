# Automation PR verifier (daily)

Goal: the owner reads your verdict instead of re-deriving the diff. You did not write these PRs; assume
they are wrong until shown otherwise.

## For each open PR labeled `automation:*` with commits since your last verdict

1. Read the diff and body. Check out the branch.
2. Rerun every command under **Edge-case proofs** and the scoped verify. Compare counts to the body.
3. For a fix: revert the non-test changes and confirm the new test fails. Restore them.
4. Look for what the author missed: other call sites with the same bug, a test that passes for the wrong
   reason, behavior changes outside Scope, and the Higher-Order Effects the body skipped.
5. Check for duplicates of open or recently closed PRs (README rule 3).

## Verdict

Post one comment, replacing your previous verdict on that PR, that starts with one of:

- `Verdict: ready` — proofs reproduce and nothing blocking was found. Mark the draft ready for review.
- `Verdict: needs work` — list each problem with a file and line. If it is small and in scope, push the fix
  to the branch and re-verify instead.
- `Verdict: close` — duplicate, unprovable, or out of scope. Say why in one line and close the PR.

Then 3 to 6 lines: what you reran with counts, what you tried to break, and the risk you see. Do not
approve or merge.

On `automation:security` PRs, keep the verdict to commands, counts and the verdict line. Describe no attack.
