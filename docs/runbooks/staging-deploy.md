# API deploy runbook (Railway)

The API and Postgres run on Railway ([ADR 0009](../adr/0009-railway-hosting.md)). `railway.toml` defines the build, a pre-deploy `npm run db:migrate`, and the `/health/live` health check.

## Deploy

Staging follows `main`. Production does not: it deploys only from the Release workflow's `api-production` job after the owner approves the `release` environment ([launch-owner-setup.md](launch-owner-setup.md)).

1. Merge to `main` with CI green.
2. Railway builds and deploys automatically. Watch the deployment in the Railway dashboard, or run `railway status` / `railway logs`.
3. A failed migration or health check stops the rollout, and the previous deployment keeps serving.
4. Smoke test: the "Staging Automation Smoke" workflow runs by itself after each deploy of `staging-automation`, and once a day. To run it by hand, start the workflow or label a PR `run-staging-smoke`. For a quick check: `curl -fsS https://<staging-host>/health/live`.

## When the smoke fails after a deploy

The workflow retries once, then its `triage` job posts to the CI alerts Slack channel and does one of two things. It never merges or rolls back by itself.

- **One commit landed since the last passing deploy, and it adds no migration:** it opens a PR that reverts that commit. Read the failed run, then merge the revert or close it and fix forward.
- **Anything else** (several commits, a migration, no new commit, or a revert that conflicts): it opens or updates the issue "Staging smoke is failing after a deploy" with the suspect commits. No new commit means staging itself is the suspect: Auth0, the database or Railway.

## Rollback

1. In Railway, open the service's Deployments, pick the last good deployment, and choose **Redeploy**. The CLI equivalent is `railway redeploy` on that deployment.
2. Migrations are forward-only. If the bad deploy ran a migration, check that the older code tolerates the new schema before redeploying. Otherwise ship a fix forward.
3. Confirm `/health/live` and the logs, then write incident notes.
