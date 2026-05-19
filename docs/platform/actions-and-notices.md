# Actions and notices

Cross-platform rules for CrewCue clients (mobile, web).

## Action policies

| Policy | Behavior | Example |
|--------|----------|---------|
| `replace` | Abort prior in-flight work; only latest outcome (success or error) applies | Map "my location" |
| `lock` | Ignore taps while in flight; UI disabled + loading until settle; unlock on failure | Save, finish setup |
| `ignoreIfBusy` | Second call is a no-op (no request, no notice) | Refresh projection |

## Notices

- **Transient (banner):** At most one app-wide. A new transient **replaces** the previous, even if the message differs. Push-notification style per platform.
- **Shell errors:** Authed shell actions (create room, outbox, sync, invites, etc.) use `NoticeBus.presentTransient` via `setStatusError` in `App.tsx`. The Operate Status rail still mirrors the last shell error string for debugging.
- **Inline:** Anchored to a control; persists until cleared, success, or user fixes input.
- **Catalog:** User-facing strings live only in `packages/platform-client/errors/en.json`. Code uses keys, never HTTP status codes.
- **Chat:** Send failures stay inline on the message bubble. Composer errors (attachments, reactions) stay inline above the composer (no global notice).

## Idempotency

- **Fingerprint:** Request bodies are hashed with `canonicalJsonStringify` from `@crewcue/platform-client` (sorted keys) on clients and API.
- **Claim → mutate → complete:** API routes claim an idempotency slot (`processing`) before mutation, store the response on success, and release the claim on validation failure or thrown errors. Stale `processing` rows older than 5 minutes may be reclaimed.
- **Migrations:** Apply through `0012_http_idempotency_state.sql` on staging/production Postgres.

## Out of scope

- Offline queue for GPX / course upload.
