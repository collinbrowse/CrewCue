# brand-loader

## Entry
crewcue://dev/loader

## Action
Open the loader fixture. The animated app icon, a standalone loader, and an inline spinner play the stacking loop. A large and a small shake loader and a busy button play the shake.

## API
none

## Permissions
none

## Success
Three stones stack, then the stack clears and repeats. The shake loaders separate, shake, and settle.

## Empty
Loading.

## Error
Couldn't load.

## Offline
Offline. Waiting for a connection.

## Accessibility labels
- crewcue.loader

## Native SDK pocket
none

## Mark
Units are a 1024 × 1024 icon canvas. Stones are pills (corner radius = half the height).
- Base: x 282, y 640, 460 × 150, no rotation, cream `#F3ECDD`.
- Middle: x 352, y 474, 320 × 136, rotated −4° about (512, 542), cream `#F3ECDD`.
- Top: x 414, y 326, 196 × 118, rotated 6° about (512, 385), orange `#FF7A3D`.
- App icon background: vertical gradient `#34404F` → `#1F2833`. Launch background: `#29333F`.
- On a light surface the cream stones become slate `#34404F`. The top stone stays orange.
- The loader crops to a 560-unit square centred on (512, 552).

## Motion
- Each stone starts 260 units above its rest position and drops in over 440 ms with an ease-out-back curve (overshoot 1.7). Its opacity ramps from 0 to 1 over the first 30% of its drop.
- Base starts at 110 ms, middle at 550 ms, top at 990 ms.
- Loop: 2200 ms period. The whole stack fades out from 1890 ms to 2200 ms, then repeats.
- Launch: plays once without the fade, holds for 250 ms after the top stone lands, then the overlay fades out over 300 ms. Skipped when the app opens from a `crewcue://dev/` deeplink.
- Reduce Motion: show the finished stack, no movement.

## Shake
For small inline use, 16–24 pt, inside or next to a busy button. Units are the same 1024-unit icon space as the mark.
- Crop: a 640-unit square at x 192, y 192, centred on (512, 512), so the lifted and tilted stones stay inside.
- Opacity is always 1. Colours and the light-surface option are the same as the mark.
- Period 1400 ms, repeating:
  - Separate, 0–250 ms: the gaps open with ease-in-out cubic. The base stays put. The middle stone lifts 48 units and the top stone lifts 96, so a 48-unit gap opens above each row.
  - Shake, 250–1050 ms: with q = (t − 250) / 800 and w = sin(6πq + φ) · sin(πq), each stone rocks an extra `7° · w` about its pivot, so its ends tip up and down, and moves `20 · w` units sideways. φ is 0 for the base, 2π/3 for the middle, and 4π/3 for the top. That is three rocks that swell and die away, each stone a third of a cycle behind the one below.
  - Close, 1050–1300 ms: the gaps close with ease-in-out cubic.
  - Rest, 1300–1400 ms: the plain stack.
- Ease-in-out cubic: p < 0.5 ? 4p³ : 1 − (2 − 2p)³ / 2.
- Reduce Motion (iOS) or animator duration scale 0 (Android): the plain stack, no movement.

## Where loaders show
- Screen-level waits use the stacking loop on the page surface: the race list in Profile while races load and none are listed yet, the chat thread from opening until the first line or a status message, and the course map until its style loads or fails.
- Busy buttons use the shake loader. A busy button is disabled but not dimmed, and shows a 20 pt shake loader before its label: Pace Recalculate, Starting estimate, Check in, Choose GPX file, Import GPX, Join, the sign-in button that was tapped, Create new race, Save checkpoint, and Start navigation.
- The stones are cream on a dark fill and slate on a light one, so a primary button in light mode uses cream and in dark mode uses slate.

## Course profile art
The brand illustration on sign-in, runner setup and the Profile hero, and the place the old runner drawing used to be. It draws what the app tracks: a course, the runner on it, and the aid stations. No people.
- Units are a 1000 × 600 canvas, y down. It stretches to its frame: x by width / 1000, y by height / 600. Line widths and radii scale by the smaller of the two.
- Ground: vertical gradient `#3A4658` → `#2A3340` → `#1E252F`. The Profile hero draws its own ground and leaves it off the art.
- Profile line through (0, 470), (120, 400), (220, 430), (350, 240), (470, 300), (590, 140), (700, 270), (820, 215), (1000, 350). The area under it is cream `#F3ECDD` at 8%.
- The runner is at (590, 140). Behind the runner the line is orange `#FF7A3D`, width 14. Ahead of the runner it is cream at 55%, width 8, dashed 22 on 22. Both have round caps and joins.
- Aid stations sit on the line at (220, 430), (470, 300) and (820, 215), radius 12. Passed ones are filled cream. The one ahead is slate `#34404F` with a cream ring, width 5.
- Runner dot: an orange halo of radius 40 at 25%, then an orange dot of radius 20 with a cream ring, width 6.
- Static. It never moves, so Reduce Motion needs nothing.
- The top bar's avatar is the settled Cairn mark (cream stones, orange top) on a slate circle.
