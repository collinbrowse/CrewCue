# pace-stop-edit

## Entry
crewcue://dev/pace-stop-edit

## Action
On Pace, a course editor (athlete, crew chief, or team manager) taps Edit planned stops and sets whole minutes (0–360) for each aid still ahead of the runner. Start, finish, and passed checkpoints stay locked. While editing, the timeline renders from the draft (`StopPlanDraft.projectedStops`): every later arrival and its cutoff status move with the change. Save sends only the changed checkpoints; Cancel drops the draft. Projected rows show the planned stop on the dwell rail ("PROJECTED · 5 MIN STOP"). The dev deeplink opens Pace already in edit mode. This feature does not call the deferred stop-plan overlay API (`/stop-plans`); `plannedStopSeconds` is course data.

## API
PATCH /race-rooms/:roomId/checkpoint-stops with `{ stops: [{ checkpointId, plannedStopSeconds }] }`, then GET /race-rooms/:roomId/schedule. All rows apply or none. The crew task board is kept. Android uses the runtime ops `stopPlanDraft` and `updatePlannedStops`.

## Permissions
Course editors only (athlete, crew_chief, team_manager). Other roles never see Edit planned stops; the server answers 403.

## Success
Planned stops saved.

## Empty
No stops on this sheet.

## Error
Couldn't save planned stops.

## Offline
Offline. Planned stops not saved. Try again when you're online.

## Accessibility labels
- crewcue.pace-stop-edit
- crewcue.pace.edit-stops
- crewcue.pace.stop-minutes.<checkpointId>
- crewcue.pace.save-stops

## Native SDK pocket
none
