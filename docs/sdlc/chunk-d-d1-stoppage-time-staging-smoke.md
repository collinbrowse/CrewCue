# Chunk D1 / WS2 — Stoppage time staging smoke (API)

**Audience:** engineers validating stoppage-time behavior on **staging** and capturing reproducible evidence for future regressions.  
**Prerequisites:** Chunk C staging smoke prerequisites (Auth0 + paid entitlement) per [chunk-c-smoke-script.md](./chunk-c-smoke-script.md).  
**Shipped implementation:** PR [#112](https://github.com/collinbrowse/CrewCue/pull/112) (merged).

---

## 1. What this smoke proves

This script validates the **server contract + correctness gates** for:

- auto-detected stoppage accumulation from accepted pings (`POST /race-rooms/:id/pings`)
- manual crew stop capture (`POST /race-rooms/:id/checkpoints/:cpId/manual-stop`)
- post-hoc resolved source selection (`PATCH /race-rooms/:id/checkpoints/:cpId/visits/:visitIndex/resolved-source`)
- aggregate `stoppageSummary` and per-split totals/deltas on `GET /race-rooms/:id/projection`

It intentionally does **not** require mobile UI — use `curl` (or HTTPie) with a staging access token.

---

## 2. Environment variables

### Manual run (pre-minted token)

Set these in your shell for copy/paste commands:

```bash
export API_BASE_URL="https://<your-staging-host>"
export ACCESS_TOKEN="<staging JWT access token>"
```

### Scripted run (recommended, used by CI)

The script `scripts/staging-smoke-stoppage.sh` mints its own token from Auth0 automation credentials and requires:

```bash
export API_BASE_URL="https://<your-staging-host>"
export AUTH0_ISSUER="https://<your-tenant>.us.auth0.com/"
export AUTH0_AUDIENCE="https://api.automation.crewcue.dev"
export AUTH0_AUTOMATION_CLIENT_ID="<client-id>"
export AUTH0_AUTOMATION_CLIENT_SECRET="<client-secret>"
export AUTH0_AUTOMATION_USER_EMAIL="<automation-user-email>"
export AUTH0_AUTOMATION_USER_PASSWORD="<automation-user-password>"
export AUTH0_AUTOMATION_CONNECTION="automation-users" # optional, defaults to automation-users
```

**Notes**

- The token must include a `Bearer` subject that is a **room member with a crew role** for manual stop + source toggle calls (`crew_member`, `crew_chief`, or `team_manager`). Athletes are rejected for those mutations.
- Keep tokens and client secrets out of logs, screen recordings, and support tickets.
- GitHub Actions workflow `.github/workflows/staging-smoke.yml` reads these values from the `staging-automation` environment secrets.

---

## 3. Helper: authorized JSON POST/GET

```bash
authcurl() {
  curl -sS "$API_BASE_URL$1" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    ${2:+-d "$2"}
}
```

---

## 4. Smoke flow (happy path)

### Step A — create + pay + activate with stoppage fields

1. Create a room (capture `ROOM_ID`).
2. Mark entitlement paid.
3. Activate with a simple 3-checkpoint course where `cp-mid` has a non-zero planned stop and a generous stoppage radius for staging GPS noise.

**Pass criteria**

- Activation returns `200` with `status: active` and `course.checkpoints[].plannedStopSeconds` present on `cp-mid`.

### Step B — seed projection with pings

Send 2–4 pings moving along the course polyline with monotonic `recordedAt`.

**Pass criteria**

- `POST .../pings` returns `201` with `decision: accepted`.
- `GET .../projection` returns `200` after the first ping (not `404`).

### Step C — auto stoppage signal

Pick `cp-mid` and verify:

- `checkpointSplits[cp-mid].visits` exists once pings enter the stoppage radius
- `autoDetected.actualStopSeconds` is non-null **only if** slowed intervals were detected (may be null on a clean fly-through)

**Pass criteria**

- No server `5xx`
- Response JSON parses and includes `stoppageSummary`

### Step D — manual stop + resolved source toggle

1. `POST /race-rooms/:id/checkpoints/cp-mid/manual-stop` with `arrivalAt` / `departureAt` bracketing a plausible aid station stop.
2. `GET .../projection` and confirm `manualEntry` is attached to the overlapping visit (or a new visit exists if no overlap).
3. `PATCH .../visits/:visitIndex/resolved-source` toggling between `auto` and `manual_crew` when both sources exist.

**Pass criteria**

- Manual stop returns `200` with `{ checkpointSplit: ... }`
- Patch returns `200`
- `activeActualStopSeconds` changes when toggling, and split totals update consistently

---

## 5. Negative tests (must-have)

Run these from a token that is **not** permitted (athlete member) and confirm **403** for:

- `POST .../manual-stop`
- `PATCH .../resolved-source`

Run these from a permitted crew token and confirm **400** for:

- `PATCH .../resolved-source` with `resolvedSource: manual_crew` when the visit has **no** `manualEntry`
- `PATCH .../resolved-source` with `resolvedSource: auto` when the visit has **no** `autoDetected`
- `PATCH .../visits/not-a-number/resolved-source` → `400 Invalid visitIndex`

---

## 6. Operator notes (expected limitations)

- **Ping interval dominates accuracy.** Short stops may read as `0` stoppage at coarse intervals — this is expected; manual stop exists as the mitigation.
- **Offline bulk flush:** server processes pings in `recordedAt` order; large gaps may produce “jump” updates on crew reads.
- **Staging data:** treat created rooms as disposable test fixtures.

---

## 7. Record results (link from issue or PR)


| Scenario                      | Result (pass/fail) | Notes / timestamps |
| ----------------------------- | ------------------ | ------------------ |
| Auto stoppage accumulation    |                    |                    |
| Manual stop overlap attach    |                    |                    |
| Source toggle auto ↔ manual   |                    |                    |
| Athlete denied mutations      |                    |                    |
| Invalid visitIndex            |                    |                    |
| ETA sanity with planned stops |                    |                    |


**Go / no-go for downstream UI slices (for example #162):**  

- Go — no correctness blockers found  
- No-go — list blocking defects with repro steps

