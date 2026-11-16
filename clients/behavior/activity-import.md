# activity-import

## Entry
crewcue://dev/activity-import

## Action
In Settings, under Past runs, choose Import past run and pick an exported .gpx, .fit or .tcx file from the watch app or Files. The server parses it into pacing history, and the list of past runs refreshes. Importing the same file again keeps one row.

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
