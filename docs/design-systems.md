# Design Systems

CrewCue design tokens live in `packages/contracts/src/designSystems.ts`. The supported clients are the native iOS and Android apps. The web client has been removed. The Expo app still reads the mobile theme until it is deleted.

- `kinetic`
- `performance`

Tokens are defined in `packages/contracts/src/designSystems.ts`.

## Runtime behavior

- Frozen Expo toggle: `apps/mobile/src/navigation/WorkspaceMenuScreen.tsx`
- Changes apply immediately across the app tree.
- Light/dark variants auto-follow the device color-scheme setting.
- Preference persists across relaunch/refresh.

## Add a new design file

1. Add a new entry to `DESIGN_SYSTEMS` in `packages/contracts/src/designSystems.ts`.
2. Add a new `DesignSystemId` union member.
3. Ensure all required token groups are provided:
  - `colors`
  - `typography`
  - `radius`
  - `spacing`
4. Keep token groups complete: `colors`, `typography`, `radius`, `spacing`.
5. If needed, refine mobile mapping logic in `apps/mobile/src/design-system/theme.ts` (`toMobileTokens`).

## Validation

Run:

- `npm run build -w @crewcue/contracts`
- `npm run typecheck -w @crewcue/mobile`

Then manually verify:

- Switching updates the Expo UI immediately while that client is still installed.
- Selected system remains active after restart/refresh.