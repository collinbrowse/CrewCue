# activity-import

## Entry
crewcue://dev/activity-import

## Action
In Settings, under Past runs, choose Import past run and pick an exported .gpx, .fit or .tcx file from the watch app or Files. The server parses it into pacing history, and the list of past runs refreshes. Importing the same file again keeps one row. In the Imported runs sheet a run whose file carries a name (a Strava GPX's track name, a TCX Activity's Notes, a FIT workout name) is titled by that name, with the date and format under it ("May 10, 2026 · GPX"); a run without one (COROS exports) is titled by its date.

## API
POST /activity-history/file with fileName and contentBase64, then GET /activity-history

## Permissions
none

## Success
Run imported to pacing history.

## Empty
Choose a .gpx, .fit or .tcx file from your watch.

## Error
Couldn't read that file. Choose a .gpx, .fit or .tcx export.

## Offline
Offline. Import the file when you're back online.

## Accessibility labels
- crewcue.activity-import

## Native SDK pocket
none
