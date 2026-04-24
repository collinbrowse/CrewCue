# Chunk A — Postgres setup and restart verification

**Audience:** operators and engineers enabling durable WS1 persistence locally or on staging.  
**Spec:** [chunk-a-ws1-persistence-spec.md](./chunk-a-ws1-persistence-spec.md)  
**Strategy:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) (Chunk A)

## 1. What this runbook does

This runbook shows how to:

1. run the API locally in `memory` mode
2. run the API locally in `postgres` mode
3. configure staging so Railway runs the API against Postgres
4. verify the key Chunk A promise: **room and invite state survives a restart**

## 2. Environment variables

Chunk A persistence uses the following API env vars:

| Variable | Required | Description |
| --- | --- | --- |
| `PERSISTENCE_MODE` | No | `memory` or `postgres`. Defaults operationally to `memory` when unset. |
| `DATABASE_URL` | Yes when `PERSISTENCE_MODE=postgres` | Postgres connection string used by the API and migration script. |
| `JWT_SECRET` | Yes for local HS256 path | Local/dev auth secret when Auth0 is not configured. |

Root `.env.example` now includes the persistence variables:

```bash
PERSISTENCE_MODE=memory
# DATABASE_URL=postgres://crewcue:crewcue@localhost:5432/crewcue
```

> **Security note:** The example `crewcue/crewcue` credentials are intentionally weak local defaults for `docker-compose.local.yml` convenience only. They must never be copied to staging or production.

## 3. Local setup

### Option A: fast local dev with in-memory persistence

Use this when you do not need restart safety.

```bash
cp .env.example .env
npm install
npm run dev:api:memory
```

Expected behavior:

- API starts without Postgres
- `GET /health/live` returns `persistence.mode = "memory"`
- restarting the server loses room state

### Option B: local Postgres-backed dev

Use this when you want to verify Chunk A restart safety locally.

#### 1. Start local Postgres

The repository already includes `docker-compose.local.yml`:

```bash
docker compose -f docker-compose.local.yml up -d postgres
```

This starts Postgres 16 on:

- host: `localhost`
- port: `5432`
- db: `crewcue`
- user: `crewcue`
- password: `crewcue`

> **Local-only credentials warning:** These credentials are for a localhost development container only. Use unique, secret-managed credentials for all cloud environments.

#### 2. Set env vars

Create or update `.env`:

```bash
JWT_SECRET=replace-with-dev-secret
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
PORT=4000
HOST=0.0.0.0
PERSISTENCE_MODE=postgres
DATABASE_URL=postgres://crewcue:crewcue@localhost:5432/crewcue
```

#### 3. Apply SQL migrations

The API has an explicit migration script:

```bash
npm run db:migrate
```

That runs `services/api/scripts/apply-sql-migrations.mjs`, which applies the SQL files in:

- `services/api/db/migrations/`

#### 4. Start the API

```bash
npm run dev:api:pg
```

#### 5. Verify health

```bash
curl http://localhost:4000/health/live
curl http://localhost:4000/health/ready
```

Expected shape:

```json
{
  "service": "api",
  "status": "ok",
  "persistence": {
    "mode": "postgres",
    "enabled": true
  }
}
```

## 4. Local restart-safety verification

Use this exact sequence to prove Chunk A behavior locally.

### 1. Create a room

Use whatever auth path you already have locally, then create a room through the app, curl, or test client.

Record:

- room id
- invite token if you create an invite

### 2. Confirm the room exists before restart

Fetch:

- `GET /race-rooms/:roomId`

and confirm the room is present.

### 3. Restart the API process

Stop and restart the API while keeping Postgres running:

```bash
npm run dev:api:pg
```

### 4. Fetch the same room again

If Chunk A is working, the room is still available after restart.

### 5. Optional direct SQL check

From the Postgres container or any SQL client:

```sql
SELECT id, team_id, updated_at FROM race_rooms_json ORDER BY updated_at DESC;
SELECT token, room_id, updated_at FROM race_room_invites_json ORDER BY updated_at DESC;
```

## 5. Staging setup (Railway + Postgres)

### 1. Provision or identify the staging Postgres instance

You need a real Postgres database for the staging API service.

The API does **not** become durable just because Terraform ran or Railway is deployed. It becomes durable only when:

- the API service has `PERSISTENCE_MODE=postgres`
- the API service has a valid `DATABASE_URL`
- migrations/tables exist

### 2. Set Railway variables on the API service

Railway → staging project → API service → Variables:

| Variable | Value |
| --- | --- |
| `PERSISTENCE_MODE` | `postgres` |
| `DATABASE_URL` | the staging Postgres connection string |

Keep the rest of your API env vars unchanged unless you are also changing auth.

### 3. Apply migrations against staging

Run the migration script with the staging `DATABASE_URL`:

```bash
DATABASE_URL='<staging postgres url>' npm run db:migrate
```

Important:

- use the API service's real database URL
- do not use a localhost URL for staging
- the migration files are idempotent and safe to re-run

### 4. Deploy or restart the API service

After variables are saved and migrations exist, redeploy the staging API so it starts in `postgres` mode.

### 5. Verify staging health

Call:

```bash
curl https://YOUR-STAGING-API/health/live
curl https://YOUR-STAGING-API/health/ready
```

Both must report:

- `persistence.mode = "postgres"`
- `persistence.enabled = true`

If they do not, staging is not actually running with Chunk A persistence enabled.

## 6. Staging restart verification

This is the real Chunk A gate.

### 1. Create or select a staging room

Create a room and note:

- room id
- team id
- optional invite token

### 2. Confirm the room is retrievable

Fetch `GET /race-rooms/:roomId` and confirm it exists.

### 3. Restart the staging API service

Use the hosting platform's restart or redeploy action.

### 4. Re-fetch the room

If the room is still present, the core Chunk A requirement is satisfied for that room path.

### 5. Optional deeper verification

Also verify:

- entitlement state still matches the pre-restart state
- activation state still matches the pre-restart state
- invite acceptance still works for an invite issued before restart

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| API crashes on startup with `PERSISTENCE_MODE=postgres requires DATABASE_URL` | `DATABASE_URL` missing | Set `DATABASE_URL` and restart |
| Health endpoint shows `mode: "memory"` | `PERSISTENCE_MODE` unset or wrong on the running service | Set `PERSISTENCE_MODE=postgres`, redeploy, then re-check health |
| Health endpoint shows `mode: "postgres"` but requests still fail on startup | database unreachable | verify the `DATABASE_URL`, network access, and Postgres availability |
| Migrations fail with `ECONNREFUSED` or `ENOTFOUND` | wrong connection string | use the actual Postgres service URL, not localhost on staging |
| Room disappears after API restart | service is still on memory mode, or write path is not persisting | check health first, then confirm rows exist in `race_rooms_json` |
| Staging/production uses `crewcue/crewcue`-style defaults | local defaults were copied to cloud env | rotate credentials immediately, store secrets in the platform secret manager, and update service env vars |

## 8. What this runbook does not guarantee

This runbook verifies the first durability slice only. It does **not** mean every runtime cache or workstream artifact is fully restart-safe yet.

Chunk A success for this slice means:

- WS1 room and invite state is durable
- staging truth can survive a process restart
- later chunks now have a real persistence foundation

## 9. Revision history

| Date | Change |
| --- | --- |
| 2026-04-23 | Initial publication of Chunk A Postgres setup and restart verification runbook. |
| 2026-04-24 | Operator validation on staging: migrations `0001`-`0009` applied; service redeployed to `68a26d30-88f6-4587-abe6-94ec8cf9af23`; `/health/live` confirmed `persistence.mode=postgres` and `enabled=true`; persisted row counts remained stable (`rooms=2`, `invites=0`) before and after redeploy. |
