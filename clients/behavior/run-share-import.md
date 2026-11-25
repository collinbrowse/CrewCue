# run-share-import

## Entry
crewcue://dev/run-share-import

## Action
A runner shares or opens a run file in CrewCue from a watch app or Files: a .gpx, .fit or .tcx, or a .zip of them (Garmin "Export Original", a COROS bulk export). iOS lists CrewCue as a share and "Open in" target for those types; Android as a VIEW and SEND target (FIT has no MIME type, so any file is offered and the extension is checked).

CrewCue opens a sheet over the current screen. All copy is client-core `SharedRunImport`.

- Signed out: "Sign in to import runs." with OK. The file is dropped; nothing is uploaded.
- Signed in: "Reading your run…", then the preview (`mode=preview`, nothing saved):
  - Each run is a row: the date as its heading ("Thu, Nov 19, 2026"), then three labeled values side by side, a small "DISTANCE", "TIME" and "CLIMB" over bold "14.6 km", "1:43:12" and "604 m" ("–" when the file lacks one). At the largest text sizes the values stack. VoiceOver and TalkBack read the row as one sentence: "Thu, Nov 19, 2026. Distance 14.6 km. Time 1:43:12. Climb 604 m."
  - One new run: "Import this run?", its row and a sketch of its route, with Import and Cancel.
  - Several: "Import 41 runs?", the first 10 rows, then "Show 31 more", which lists the rest. The list stays open through a fold or rotation, and closes when a new file arrives.
  - Runs already in pacing history show an outlined "Already imported" badge with dimmed values and aren't counted. When every run is already imported, the title is "Already in pacing history." and only Done shows.
  - Files in a .zip that aren't runs, or can't be read: "3 files can't be read", with the list under it.
  - A whole watch-app export (up to 200 MB and 5,000 files, for example a COROS bulk export) keeps runs and hikes from the year before its newest run. Rides, walks and other sports, older runs, and files without a run are counted in one line: "1,905 files skipped: 847 older than a year, 344 not runs or hikes, 714 unreadable". The unreadable ones are listed under "Unreadable files" (the first 50). A single shared run imports whatever its date.
- The upload runs as a background job on the server, so a slow server or a big export doesn't time out: the app keeps showing "Reading your run…" or "Importing…" until the job finishes (it checks every 1.5 s, for up to 10 minutes). If the server lost the job (a restart): "The upload was interrupted. Share the file again." If 10 minutes pass: "This export is taking too long. Try again, or export fewer runs."
- Import (`mode=import`) shows "Importing…", then "Run imported." or "41 runs imported." with Done. Settings > Past runs shows the new runs the next time it loads.
- Cancel or Done closes the sheet and returns to the screen underneath, unchanged.

The dev link opens the sheet with a file from the app's documents folder: `crewcue://dev/run-share-import?file=<name>`.

## API
POST /activity-history/upload?mode=preview|import&fileName=<name> with the file's bytes as the body → 202 `{jobId}`
GET /activity-history/upload-jobs/:jobId → 202 while running, then the preview or import result

## Permissions
none

## Success
Run imported.

## Empty
Export a run from your watch app and share it to CrewCue.

## Error
Couldn't read that file. Choose a .gpx, .fit, .tcx or .zip export.

## Offline
Offline. Import the file when you're back online.

## Accessibility labels
- crewcue.run-share-import (the sheet)
- crewcue.run-share-import.confirm (Import / "Import 41 runs")
- crewcue.run-share-import.cancel (Cancel / Done / OK)

## Native SDK pocket
none
