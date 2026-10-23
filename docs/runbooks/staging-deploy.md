# API deploy runbook (Railway)

The API and Postgres run on Railway ([ADR 0009](../adr/0009-railway-hosting.md)). `railway.toml` defines the build, a pre-deploy `npm run db:migrate`, and the `/health/live` health check.

## Deploy

1. Merge to `main` with CI green.
2. Railway builds and deploys automatically. Watch the deployment in the Railway dashboard, or run `railway status` / `railway logs`.
3. A failed migration or health check stops the rollout, and the previous deployment keeps serving.
4. Smoke test: `curl -fsS https://<staging-host>/health/live`. For the broader authenticated smoke, label a PR `run-staging-smoke` or run the "Staging Automation Smoke" workflow.

## Rollback

1. In Railway, open the service's Deployments, pick the last good deployment, and choose **Redeploy**. The CLI equivalent is `railway redeploy` on that deployment.
2. Migrations are forward-only. If the bad deploy ran a migration, check that the older code tolerates the new schema before redeploying. Otherwise ship a fix forward.
3. Confirm `/health/live` and the logs, then write incident notes.
