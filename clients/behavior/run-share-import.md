# run-share-import

## Entry
crewcue://dev/run-share-import

## Action
A runner shares or opens a run file in CrewCue from a watch app or Files: a .gpx, .fit or .tcx, or a .zip of them (Garmin "Export Original", a COROS bulk export). iOS lists CrewCue as a share and "Open in" target for those types; Android as a VIEW and SEND target (FIT has no MIME type, so any file is offered and the extension is checked).

CrewCue opens a sheet over the current screen. All copy is client-core `SharedRunImport`.

- Signed out: "Sign in to import runs." with OK. The file is dropped; nothing is uploaded.
- Signed in: "Reading your run…", then the preview (`POST /activity-history/preview`, nothing saved):
  - One new run: "Import this run?", its line (date · km · time · m climb) and a sketch of its route, with Import and Cancel.
  - Several: "Import 41 runs?", one line per run, and "Import 41 runs".
  - Runs already in pacing history show "Already imported" and aren't counted. When every run is already imported, the title is "Already in pacing history." and only Done shows.
  - Files in a .zip that aren't runs, or can't be read: "3 files can't be read", with the list under it.
- Import (`POST /activity-history/archive`) shows "Importing…", then "Run imported." or "41 runs imported." with Done. Settings > Past runs shows the new runs the next time it loads.
- Cancel or Done closes the sheet and returns to the screen underneath, unchanged.

The dev link opens the sheet with a file from the app's documents folder: `crewcue://dev/run-share-import?file=<name>`.

## API
POST /activity-history/preview, POST /activity-history/archive (both with fileName and contentBase64)

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
