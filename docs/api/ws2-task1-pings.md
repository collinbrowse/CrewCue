# WS2 Task 1 — Athlete ping ingest

## Purpose

Members of a **paid** race room can submit **location pings** while the room is **active**. Each request is either **accepted** (stored as the latest ping for that room) or **rejected** with a machine-readable reason. Decisions are appended to an in-memory history (capped) for inspection and tests.

## Authentication and gates

Same JWT claims as other race-room routes (`sub`, `teamIds`, `roomRoles`).

Order of checks:

1. **401** — missing or invalid JWT / claims mapping.
2. **404** — room does not exist.
3. **403** — caller is not a room member.
4. **402** / **403** — entitlement unpaid / expired (same semantics as `GET /race-rooms/:roomId`).
5. **400** — JSON body fails schema validation.
6. **422** — body is valid but ping is rejected (see reasons below).
7. **201** — ping accepted.

## `POST /race-rooms/:roomId/pings`

**Body (JSON)**

| Field | Type | Required |
| --- | --- | --- |
| `latitude` | number, −90…90 | yes |
| `longitude` | number, −180…180 | yes |
| `recordedAt` | ISO 8601 datetime | yes (device time when fix was taken) |
| `horizontalAccuracyMeters` | positive number | no; if present must be ≤ 500 |

**Constants (server)**

| Rule | Value |
| --- | --- |
| Max clock skew (`recordedAt` vs server receive time) | 120 seconds |
| Max implied speed vs previous accepted ping | 15 m/s |
| Max reported horizontal accuracy | 500 m |

**201 response** (`decision: "accepted"`)

Includes `pingId`, `roomId`, `recordedAt`, `receivedAt`, coordinates, and optional accuracy echo.

**422 response** (`decision: "rejected"`)

| `reason` | Meaning |
| --- | --- |
| `room_not_active` | Room is not `active` (e.g. still `draft`). |
| `clock_skew` | `recordedAt` too far from server time. |
| `implausible_motion` | Distance vs time from last accepted ping implies speed above threshold. |
| `accuracy_too_poor` | `horizontalAccuracyMeters` above threshold. |

## `GET /race-rooms/:roomId/pings/history`

Returns recent ping decisions for the room. Requires membership and **paid** entitlement (same as ping ingest).

**Query**

| Param | Default | Range |
| --- | --- | --- |
| `limit` | 20 | 1–50 |

**200 response:** `{ "decisions": [ ... ] }` — newest entries at the end of the array (last `limit` items).

Each entry: `id`, `at`, `actor`, `decision` (`accepted` | `rejected`), optional `reason`, optional `pingId` (when accepted).

## Logging

Accepted and rejected ingest paths emit structured log lines with message **`ping_decision`** and payload `ping_decision: { roomId, actor, decision, reason?, pingId? }`.

## Notes

- State is **in-memory**; restarting the API clears pings and history.
- First ping in a room has no motion check; subsequent pings compare to the last **accepted** ping only (rejected pings do not move the baseline).
