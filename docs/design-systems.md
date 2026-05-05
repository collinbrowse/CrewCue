# Design Systems

CrewCue now supports global runtime switching between design systems on both clients:

- `kinetic`
- `performance`

Both mobile and web read from shared definitions in `packages/contracts/src/designSystems.ts`.

## Runtime behavior

- Mobile toggle location: `apps/mobile/src/navigation/WorkspaceMenuScreen.tsx`
- Web toggle location: `apps/web/src/MapWorkspace.tsx`
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
4. Update web CSS token mapping in `apps/web/src/index.css` with a new `:root[data-design-system="..."]` block.
5. If needed, refine mobile mapping logic in `apps/mobile/src/design-system/theme.ts` (`toMobileTokens`).
6. Expose the new option in both toggles:
  - `apps/mobile/src/navigation/WorkspaceMenuScreen.tsx`
  - `apps/web/src/MapWorkspace.tsx`

## Validation

Run:

- `npm run build -w @crewcue/contracts`
- `npm run typecheck -w @crewcue/web`
- `npm run typecheck -w @crewcue/mobile`

Then manually verify:

- Switching updates UI immediately on both clients.
- Selected system remains active after restart/refresh.