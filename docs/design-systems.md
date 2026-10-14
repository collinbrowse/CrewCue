# Design Systems

CrewCue has one design system: **Night Trail**. The native iOS and Android apps are the only clients.

## Sources

- Visual target: `crewcue_design/*/screen.png` (map, expanded milestone, course schedule, crew chat, runner profile). These are day-mode mockups.
- Token spec: `crewcue_design/night_trail_performance/DESIGN.md`.
- Canonical tokens: `packages/contracts/src/designSystems.ts` (`nightTrail`, light and dark).
- iOS: `apps/ios/CrewCue/Design/CrewTheme.swift`.
- Android: `apps/android/app/src/main/kotlin/com/crewcue/android/ui/theme/CrewTheme.kt`.

## Rules

- Light matches the mockups. Dark uses the `nightTrail.dark` variant and follows the device setting.
- Fonts are the platform system fonts (SF Pro, Roboto) at the DESIGN.md sizes and weights. Lexend and Inter are not bundled.
- Shapes: capsule buttons and chips, 32pt cards, circular icon containers.
- iOS uses a toned-down Liquid Glass (`glassEffect` with a strong surface tint) on the tab bar, top bar, map chips and sheet, and content cards. Android uses solid tonal surfaces and no blur.
- Feature screens do not hardcode colors or font sizes. Add a token or component in the theme file instead.

## Changing tokens

1. Edit `nightTrail` in `packages/contracts/src/designSystems.ts`.
2. Mirror the change in both native theme files.
3. Run `npm run build -w @crewcue/contracts`.
4. Check light and dark with `npm run agent:ios:ready` and `npm run agent:android:ready`.
