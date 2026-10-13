# ADR 0009: Host the API and Postgres on Railway

- Status: Approved
- Date: 2026-10-13
- Supersedes: the cloud-provider and IaC parts of [ADR 0004](./0004-cloud-iac-auth-baseline.md). Auth0 and the claims model stay.

## Context

ADR 0004 chose AWS with Terraform. In practice the API and Postgres have always run on Railway, configured by `railway.toml`. The AWS Terraform only declared an S3 bucket and a log group, and CI never applied it because no AWS credentials were configured. The "Deploy Staging" workflow passed on every merge while deploying nothing.

## Decision

- Railway builds and deploys the API from `main` using `railway.toml`. Its pre-deploy step runs SQL migrations, and it health-checks `/health/live`.
- Rollback is a Railway redeploy of a previous deployment.
- The AWS Terraform and the no-op deploy/rollback workflows are removed.
- The Auth0 tenant definition stays as Terraform in `infra/auth0`. It is applied by hand.

## Consequences

- One deploy path, visible in Railway, instead of a GitHub workflow that looked like a deploy but wasn't.
- Infra is configured in the Railway dashboard plus `railway.toml`, not in reviewable IaC. Revisit if the service count grows.
