# Design systems

CrewCue has one design system: **Ember**, built from the app icon's slate, cream and orange. The native iOS and Android apps are the only clients.

Ember replaced the purple Night Trail palette in Nov 2026. The `crewcue_design/` mockups still show Night Trail's purple: use them for layout, not color.

## Sources

- Layout target: `crewcue_design/*/screen.png` (map, expanded milestone, course schedule, crew chat, runner profile). These are day-mode mockups in the old purple.
- Type, shape and spacing spec: `crewcue_design/night_trail_performance/DESIGN.md`. Its colors are superseded by `ember`.
- Canonical tokens: `packages/contracts/src/designSystems.ts` (`ember`, light and dark).
- iOS: `apps/ios/CrewCue/Design/CrewTheme.swift`.
- Android: `apps/android/app/src/main/kotlin/com/crewcue/android/ui/theme/CrewTheme.kt`.

## Rules

- Light matches the mockups. Dark uses the `ember.dark` variant and follows the device setting.
- Fonts are the platform system fonts (SF Pro, Roboto) at the DESIGN.md sizes and weights. Lexend and Inter are not bundled.
- Shapes: capsule buttons and chips, 32pt cards, circular icon containers.
- iOS uses a toned-down Liquid Glass (`glassEffect` with a strong surface tint) on the tab bar, top bar, map chips and sheet, and content cards. Android uses solid tonal surfaces and no blur.
- Primary (ember `#B5441A`, dark `#FF8F5C`) is for actions and the runner. Secondary (slate) is for the course line and calm UI. The icon's bright orange `#FF7A3D` is too light for white text: use it only for marks, never as a button fill.
- Brand art: the Cairn mark and the course-profile art (`clients/behavior/brand-loader.md`). No people illustrations.
- Feature screens do not hardcode colors or font sizes. Add a token or component in the theme file instead.

## Changing tokens

1. Edit `ember` in `packages/contracts/src/designSystems.ts`.
2. Mirror the change in both native theme files.
3. Run `npm run verify:contracts`.
4. Check light and dark with `npm run agent:ios:ready` and `npm run agent:android:ready`.
