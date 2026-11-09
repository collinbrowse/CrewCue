# CrewCue knowledge base

Last reconciled: 2026-11-09 at `4bb5e81`.

A map of the system that keeps itself current: what the parts are, how data moves between them, and what can go wrong.

| Page | What it answers | Kept current by |
| --- | --- | --- |
| [architecture.md](architecture.md) | What the components are and how they connect | Refresh workflow |
| [data-flow.md](data-flow.md) | How pings, projections, chat, Strava, and invites move end to end | Refresh workflow |
| [risks.md](risks.md) | Triaged risk register with stable IDs | Refresh workflow |
| [generated/api-routes.md](generated/api-routes.md) | Every route, its auth guard, file and line | `kb:check` in CI |
| [generated/data-model.md](generated/data-model.md) | Postgres schema replayed from migrations, and who touches each table | `kb:check` in CI |
| [generated/modules.md](generated/modules.md) | Workspaces, API import graph, client-core types, native trees | `kb:check` in CI |
| [generated/config.md](generated/config.md) | Env vars, where they are read, which look secret | `kb:check` in CI |
| [generated/risk-signals.md](generated/risk-signals.md) | Unguarded routes, room routes without a membership check, large files, timers, untested modules, parity gaps | `kb:check` in CI |
| [generated/kb.json](generated/kb.json) | The same facts as JSON, for tools and agents | `kb:check` in CI |

## How it stays current

Two loops.

1. **Facts, on every PR.** [scripts/kb/generate-kb.mjs](../../scripts/kb/generate-kb.mjs) reads the code and writes `generated/`. The output has no timestamps, so CI's `checks` job runs `npm run kb:check` and fails when a PR changes routes, migrations, env reads, or modules without regenerating. Fix: `npm run kb:generate` and commit.
2. **Narrative, after merge.** [kb-refresh.yml](../../.github/workflows/kb-refresh.yml) runs on pushes to `main` that touch code, and weekly. It regenerates the facts, then Claude reconciles the three narrative pages against the diff since [`.refresh-sha`](.refresh-sha), following [refresh-prompt.md](../../scripts/kb/refresh-prompt.md). The result is a PR that may touch only `docs/kb/**`, with auto-merge on.

The refresh workflow needs the `ANTHROPIC_API_KEY` repository secret. Add `KB_BOT_TOKEN` (the agent bot's token) too: a PR opened with the default `GITHUB_TOKEN` does not trigger CI, so its required checks never run and it cannot auto-merge. Without the API key the workflow logs a notice and exits.

## Using it

- **Before changing code:** read the flow in [data-flow.md](data-flow.md) and the risks for the files you touch.
- **Reviewing a PR:** the diff to `generated/` shows what the change does to the system: a new route and its guard, a new table, a new secret.
- **Agents:** `generated/kb.json` is the cheapest way to answer "which routes touch X" or "who reads this env var".
- **Run the refresh locally:** ask Claude Code to follow `scripts/kb/refresh-prompt.md`.

Do not edit `generated/` by hand. Edit the narrative pages freely; the refresh keeps your edits and only reconciles them with the code.
