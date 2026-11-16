# Human verification queue

Work merged without a human check. Each item needs a real device, owner credentials, or a person on a course. Tick it here (or delete the section) once done, and commit any proof files the row needs.

Tracking PR: the open draft PR that adds this file. Close it when every box is ticked.

## #645: location-heartbeat on real phones

Merged with `location-heartbeat` at `fail` and `"proof": "physical"` on both platforms. The gate rejects `pass` unless the proof sets `deviceClass: "physical"` and its `checked.Action` covers the list in `clients/behavior/location-heartbeat.md` `## Proof`.

### iPhone (athlete account)

- [ ] Screen locked in a pocket for 2+ hours: one sample per interval reaches the server.
- [ ] App ended by the system or the debugger (not swiped away): samples resume without opening the app. This is the new `CompositionRoot` → `resumeRaceTrackingAtLaunch` path.
- [ ] Same, with a weak or hanging network at relaunch: samples are taken and queued, then delivered when the network returns.
- [ ] Real loss of service (no coverage or airplane mode): the backlog reaches the server in one batch when service returns.
- [ ] Opening the map after a background relaunch flushes queued samples right away (not one interval later).
- [ ] Commit `clients/behavior/proofs/location-heartbeat.ios.json` with `deviceClass: "physical"`, then flip the iOS row to `pass`.

### Samsung (or other OEM) Android, default battery settings

- [ ] Location section shows "Android may stop tracking to save battery…" with **Open battery settings** while CrewCue is not Unrestricted.
- [ ] **Open battery settings** opens App info, where battery use can be set to Unrestricted.
- [ ] After setting Unrestricted and returning, the prompt is gone.
- [ ] After setting it back to Optimized and returning, the prompt comes back (EC5, never verified).
- [ ] Screen locked 2+ hours, one sample per interval; app ended by the system resumes; airplane-mode backlog flushes in one batch.
- [ ] Commit `clients/behavior/proofs/location-heartbeat.android.json` with `deviceClass: "physical"`, then flip the Android row to `pass`.

### Course dry run (before the pilot)

- [ ] Run a real course with both phones. Record the largest gap between pings and battery % per hour.

## #674: crew chat push (#650, #563)

Merged with `chat-thread` at `pass` (simulator and emulator proofs) and `push-registration` at `fail` on both platforms. Setup: `docs/runbooks/chat-push.md`.

- [ ] Owner credentials in place: `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `FCM_SERVICE_ACCOUNT_JSON` on the API; `apps/android/app/google-services.json` locally.
- [ ] iOS push-registration: Empty, Error, Offline states (Success already proven).
- [ ] Android push-registration: Success (FCM token queued) and Offline (Error and Empty already proven).
- [ ] Real iPhone: a chat push arrives, and tapping it switches to that race and opens its chat.
- [ ] Real Android phone: same.
- [ ] Commit the `push-registration` proofs, flip both rows to `pass`, then close #650 and #563.
