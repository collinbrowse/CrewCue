# Knowledge base refresh

You maintain CrewCue's knowledge base in `docs/kb/`. Bring the three narrative pages back in line with the code.

## Inputs

- `docs/kb/generated/*.md` and `kb.json`: facts produced by `npm run kb:generate`. Already current. Never edit them.
- `docs/kb/.refresh-sha`: the commit the narrative pages were last reconciled against.
- The changes since then: `git log --oneline $(cat docs/kb/.refresh-sha)..HEAD` and `git diff $(cat docs/kb/.refresh-sha)..HEAD --stat`. Read the diffs of the files that matter.
- `docs/adr/`, `docs/release/readiness.md`, `AGENTS.md`, and `.claude/rules/` for intent.

## What to update

- `docs/kb/architecture.md`: components, boundaries, deployment. Change it when a component, package, external service, or boundary appears, moves, or goes away.
- `docs/kb/data-flow.md`: end-to-end flows with file references. Change it when a flow's path, storage, or auth changes.
- `docs/kb/risks.md`: the triaged risk register. Add a risk the diff introduces. Close a risk the diff fixes: move it to "Closed" with the commit or PR. Re-check every `none detected` route and every count in `generated/risk-signals.md` against the register.

## Rules

1. Every claim cites a file (`path/to/file.ts:123` style links, relative to the page) or a generated page. If you cannot cite it, do not write it.
2. Prefer editing a sentence to rewriting a section. Keep the pages' structure and tone: short, plain, present tense.
3. A risk entry has: ID (keep existing IDs, next free number for new ones), severity (high/medium/low), what can go wrong, where, and what would close it. Severity reflects impact on a runner or crew on race day, or on user data.
4. Do not invent a fix, plan, or owner. Do not copy secrets or env values.
5. When you are done, write the current `HEAD` sha to `docs/kb/.refresh-sha`, and update the "Last reconciled" line at the top of `docs/kb/README.md` to the date and short sha.
6. If nothing in the diff affects the narrative, only do step 5.
7. Touch only files under `docs/kb/`.

End with a summary of up to five lines: what changed in each page and any risk opened or closed. It becomes the PR description.
