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
- **Inline:** Anchored to a control; persists until cleared, success, or user fixes input.
- **Catalog:** User-facing strings live only in `packages/platform-client/errors/en.json`. Code uses keys, never HTTP status codes.
- **Chat:** Send failures stay inline on the message bubble only (no global notice).

## Out of scope

- Offline queue for GPX / course upload.
