# Staging Deploy Runbook

## Deploy

1. Merge approved changes to `main`
2. Wait for `CI` workflow to pass
3. Trigger or wait for `Deploy Staging` workflow
4. Confirm service health endpoints and telemetry after deploy

## Rollback

1. Identify last known good git ref
2. Trigger `Rollback Staging` workflow with `rollback_ref`
3. Confirm health endpoints and logs return to baseline
4. Record incident notes for follow-up
