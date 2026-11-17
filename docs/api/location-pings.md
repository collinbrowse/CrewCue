# Athlete ping ingest

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
| `uploadIntervalSeconds` | integer 10…900 | no; athlete app **target** seconds between pings (battery + race-length policy). When set on an **accepted** ping, the server remembers it for the room and uses it to derive projection **staleness** threshold (see [projection.md](./projection.md#timeliness-confidence-and-staleness)). |

**Constants (server)**

| Rule | Value |
| --- | --- |
| Max clock skew (`recordedAt` vs server receive time) | 120 seconds |
| Max implied speed vs previous accepted ping | 15 m/s |
| Max reported horizontal accuracy | 500 m |

**201 response** (`decision: "accepted"`)

Includes `pingId`, `roomId`, `recordedAt`, `receivedAt`, coordinates, optional accuracy echo, and when projection is available a **`projection`** object (including **staleness** fields if the room has an active course).

**422 response** (`decision: "rejected"`)

| `reason` | Meaning |
| --- | --- |
| `room_not_active` | Room is not `active` (e.g. still `draft`). |
| `clock_skew` | `recordedAt` too far from server time. |
| `implausible_motion` | Distance vs time from last accepted ping implies speed above threshold. |
| `accuracy_too_poor` | `horizontalAccuracyMeters` above threshold. |
| `stale_recorded_at` | `recordedAt` is not after the room's last accepted ping (replay or out of order). Clients drop the sample and do not retry. |

## `GET /race-rooms/:roomId/pings/history`

Returns recent ping decisions for the room. Requires membership and **paid** entitlement (same as ping ingest).

**Query**

| Param | Default | Range |
| --- | --- | --- |
| `limit` | 20 | 1–50 |

**200 response:** `{ "decisions": [ ... ] }` — newest entries at the end of the array (last `limit` items).

Each entry: `id`, `at`, `actor`, `decision` (`accepted` | `rejected`), optional `reason`, optional `pingId` (when accepted).

## `GET /race-rooms/:roomId/pings/latest`

The latest **accepted** ping for the room. Crew phones drive race progress (mile, % complete, next aid, ETA, on-track, average pace, elevation remaining, last ping) from this response, never from their own GPS, so every member sees the same readout. Same gates as ping history (401 / 404 / 403 / 402).

**200 response** (`RaceRoomLatestPingResponse` in `@crewcue/contracts`):

| Field | Notes |
| --- | --- |
| `roomId` | Room id. |
| `ping` | Absent until the first accepted ping. `pingId`, `latitude`, `longitude`, `recordedAt` (athlete device time, used for "last ping"), `receivedAt` (server accept time), and optional `progressMeters`. |
| `ping.progressMeters` | Route-snapped progress from the room projection for this exact ping. Absent when the room has no projection for it (no planned pace, race start, or route line). Clients then snap the ping to the nearest checkpoint. |
| `stalenessThresholdSeconds` | Seconds after `recordedAt` when the reading is stale. Same rule as projection confidence: `min(3 × uploadIntervalSeconds, 15 min)`, else 15 min. |
| `evaluatedAt` | Server time the response was built. |

Rejected pings never replace `ping`.

## Tracking reminders (push)

When the runner hasn't started tracking, the API pushes them a reminder 45 minutes before `raceStartAt` and another 5 minutes before ([trackingReminderScheduler.ts](../../services/api/src/lib/trackingReminderScheduler.ts), started in `server.ts`, stopped on `app.close()`).

| Rule | Value |
| --- | --- |
| Tick | every 60 s, one listing per window: rooms starting in (now + 40 min, now + 45 min] and in (now, now + 5 min]. Postgres: an indexed range on `payload->>'raceStartAt'` that returns only the six fields the scheduler reads, never the payload (course GPX, overlay, workspace). |
| Windows | `t45` while now is in [start − 45 min, start − 40 min); `t5` in [start − 5 min, start). A tick outside a window never sends it: an API down through T-45 skips `t45` and still sends `t5`. Nothing after the start. Each room's window is judged again on a fresh clock right before its claim, so a pass slowed by earlier rooms never sends late (`window_closed`), and the copy counts from that same time. |
| Expiry | the push expires when its window closes: `t45` at start − 40 min, `t5` at the start (`apns-expiration`; FCM `android.ttl`, the seconds left). A phone without signal at the start never shows it late, and no provider request (a retry included) starts after it. |
| Collapse | `apns-collapse-id` and the FCM notification tag are `tracking:<roomId>`: `t5` replaces an unread `t45`, and neither replaces a chat or schedule push for the room. |
| Who | the runner (`athleteId`) only, every device registered with `POST /chat/push/tokens`, and only while they are on the room's roster (a runner who hasn't joined can't send pings, and the room's creator sets `athleteId`). Crew never get it. |
| Paid | `entitlement.status` `paid` only; `unpaid` and `expired` get nothing. The room must be `active` (pings to any other room are refused). |
| Tracking | an accepted ping recorded at or after start − 60 min suppresses the reminder. Pre-start (test) pings count; they are accepted and stored, only kept out of the projection. |
| Once | an instance inserts a claim row in `tracking_reminders_sent` (key: room, slot, race start) before sending and sends only if its insert won; memory mode keeps the key in process. A crash between the claim and the send skips that reminder, never sends it twice. A runner with no device is not claimed, so a device registered later in the window still gets it. |
| Start moved | the start is in the key, so both reminders re-arm for the new start. |
| Cleanup | claim rows go with the room (`ON DELETE CASCADE`); rows older than 3 days are deleted hourly. |

The push goes through the chat push path (`dispatchChatPush`) with `type: "tracking"` and `roomId`. Title `Start tracking`; body `Your race starts in 45 minutes. Start tracking so your crew can follow you.` (or 5 minutes). The minutes are the whole minutes left when it is sent, rounded up; never a clock time.

Logs: `tracking_reminder_sent` (`roomId`, `slot`, `delivered`, `attempts`, `failures`; never tokens), `tracking_reminder_pass` when a tick had rooms in a window, warnings `tracking_reminder_dispatch_failed`, `tracking_reminder_check_failed`, `tracking_reminder_pass_failed`.

## Logging

Accepted and rejected ingest paths emit structured log lines with message **`ping_decision`** and payload `ping_decision: { roomId, actor, decision, reason?, pingId? }`.

## Notes

- State is **in-memory**; restarting the API clears pings and history.
- First ping in a room has no motion check; subsequent pings compare to the last **accepted** ping only (rejected pings do not move the baseline).
