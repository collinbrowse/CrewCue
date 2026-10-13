# Design systems

Design tokens (colors, typography, radius, spacing) are defined once in `packages/contracts/src/designSystems.ts`. Two systems exist, `kinetic` and `performance`, each with light and dark variants.

The native apps do not consume these tokens yet. Until they do, iOS and Android screens use platform defaults.

## Add or change a design system

1. Edit `DESIGN_SYSTEMS` in `packages/contracts/src/designSystems.ts`. Add a `DesignSystemId` member for a new system.
2. Keep every token group complete: `colors`, `typography`, `radius`, `spacing`.
3. `npm run verify:contracts`.
