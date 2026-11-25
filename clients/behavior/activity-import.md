# activity-import

## Entry
crewcue://dev/activity-import

## Action
In Settings, under Past runs, choose Import past run and pick an exported .gpx, .fit or .tcx file from the watch app or Files. The server parses it into pacing history, and the list of past runs refreshes. Importing the same file again keeps one row. In the Imported runs sheet a run whose file carries a name (a Strava GPX's track name, a TCX Activity's Notes, a FIT workout name) is titled by that name, with the date and format under it ("May 10, 2026 · GPX"); a run without one (COROS exports) is titled by its date.

To choose which runs shape the estimate, open the run count under Past runs ("N runs imported ›") to see Imported runs, then swipe a run left and tap Remove. A confirm step asks "Remove this run?" and says it will no longer shape the pace estimate and can be imported again later. Remove run calls the API; Cancel changes nothing. The list then reloads without the run. When the open race is the person's own (they are its runner), the sheet asks "Run removed. Recalculate your estimate without it?" with a Recalculate button that recalculates that race's estimate. Otherwise it says the next estimate leaves the run out. Removing touches only pacing history: the original file and any race stay as they are.

## API
POST /activity-history/file with fileName and contentBase64, then GET /activity-history
DELETE /activity-history/:historyId (owner only; 404 for an unknown id or another athlete's run, which the app treats as already removed), then GET /activity-history

## Permissions
none

## Success
Run imported to pacing history.
Removing: the run leaves Imported runs and the next POST /pacing-estimates ignores it.

## Empty
Choose a .gpx, .fit or .tcx file from your watch.

## Error
Couldn't read that file. Choose a .gpx, .fit or .tcx export.
Removing: Couldn't remove the run. Try again.

## Offline
Offline. Import the file when you're back online.
Removing: You're offline. The run was not removed.

## Accessibility labels
- crewcue.activity-import

## Native SDK pocket
none
