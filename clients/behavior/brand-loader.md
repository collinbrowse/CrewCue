# brand-loader

## Entry
crewcue://dev/loader

## Action
Open the loader fixture. The animated app icon, a standalone loader, and an inline spinner play the stacking loop.

## API
none

## Permissions
none

## Success
Three stones stack, then the stack clears and repeats.

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
