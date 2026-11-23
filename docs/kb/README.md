# CrewCue knowledge base

Last reconciled: 2026-11-23 at `79b1262`.

A map of the system that keeps itself current: what the parts are, how data moves between them, and what can go wrong.

| Page | What it answers | Kept current by |
| --- | --- | --- |
| [architecture.md](architecture.md) | What the components are and how they connect | Refresh workflow |
| [data-flow.md](data-flow.md) | How pings, projections, chat, Strava, and invites move end to end | Refresh workflow |
| [risks.md](risks.md) | Triaged risk register with stable IDs | Refresh workflow |
| [generated/api-routes.md](generated/api-routes.md) | Every route, its auth guard, file and line | Refresh workflow (script) |
| [generated/data-model.md](generated/data-model.md) | Postgres schema replayed from migrations, and who touches each table | Refresh workflow (script) |
| [generated/modules.md](generated/modules.md) | Workspaces, API import graph, client-core types, native trees | Refresh workflow (script) |
| [generated/config.md](generated/config.md) | Env vars, where they are read, which look secret | Refresh workflow (script) |
| [generated/risk-signals.md](generated/risk-signals.md) | Unguarded routes, room routes without a membership check, large files, timers, untested modules, parity gaps | Refresh workflow (script) |
| [generated/kb.json](generated/kb.json) | The same facts as JSON, for tools and agents | Refresh workflow (script) |

## How it stays current

Two loops.

1. **Facts, after merge.** [scripts/kb/generate-kb.mjs](../../scripts/kb/generate-kb.mjs) reads the code and writes `generated/`. Feature PRs do not commit it, so open PRs never conflict over it or go stale when another PR merges. On a PR, CI's `kb-drift` job runs the generator and prints the diff (new routes, unguarded routes, tables, env vars) in its job summary; it never fails. [kb-refresh.yml](../../.github/workflows/kb-refresh.yml) regenerates and commits the facts on every run, with or without Claude credentials.
2. **Narrative, after merge.** The same [kb-refresh.yml](../../.github/workflows/kb-refresh.yml) run, on pushes to `main` that touch code and weekly, then has Claude reconcile the three narrative pages against the diff since [`.refresh-sha`](.refresh-sha), following [refresh-prompt.md](../../scripts/kb/refresh-prompt.md). The result is a PR that may touch only `docs/kb/**`, with auto-merge on.

The refresh workflow signs in to Claude with the `CLAUDE_CODE_OAUTH_TOKEN` repository secret (your Claude subscription; create it with `claude setup-token`), or with `ANTHROPIC_API_KEY` (API credits) when that token is absent. Add `KB_BOT_TOKEN` (the agent bot's token) too: a PR opened with the default `GITHUB_TOKEN` does not trigger CI, so its required checks never run and it cannot auto-merge. With neither Claude secret the workflow still refreshes the fact pages and skips the narrative.

[kb-drift-watch.yml](../../.github/workflows/kb-drift-watch.yml) runs `kb:check` on `main` daily. Stale with a refresh PR under 24 hours old is normal lag; otherwise it opens or updates the issue "Knowledge base on main is stale".

## Using it

- **Before changing code:** read the flow in [data-flow.md](data-flow.md) and the risks for the files you touch.
- **Reviewing a PR:** the diff to `generated/` shows what the change does to the system: a new route and its guard, a new table, a new secret.
- **Agents:** `generated/kb.json` is the cheapest way to answer "which routes touch X" or "who reads this env var".
- **Run the refresh locally:** ask Claude Code to follow `scripts/kb/refresh-prompt.md`.

Do not edit `generated/` by hand. Edit the narrative pages freely; the refresh keeps your edits and only reconciles them with the code.
