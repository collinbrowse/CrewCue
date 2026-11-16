---
description: SwiftUI presentation structure for apps/ios
paths:
  - "apps/ios/**"
---

# iOS presentation

Use this when a screen does more than render `FeatureScreen`. A bugfix inside an existing fixture view does not restructure the shell.

- SwiftUI. `@Observable` model per screen. The view renders. The model calls `packages/client-core`. No view-model base class and no second repository.
- `App/CompositionRoot.swift` builds `ClientGraph` and passes it in.
- `App/AppRouter.swift` is a `NavigationStack` bound to `Route`.
- `Logging/OSLogLogger.swift` adapts the client-core `Logger`.
- `Screens/<Feature>/` holds the model and view. Pockets stay app-local, same split as `apps/ios/CrewCue/Pockets.swift`.
- Accessibility id `crewcue.<feature>`, a spoken label, and Dynamic Type. Identifiers stay stable for `snapshot_ui`.
- The first iOS code task that compiles the app sets `SWIFT_VERSION` and strict concurrency on the app target.
- Shared policy, errors, and routes: `.claude/rules/client-core-architecture.md`.

## Adaptive layout (every new or reworked screen)

The app runs on every supported iPhone at every size the system gives it. That includes standard iPhones, iPhone Duo's outer display (compact width), its inner display (regular width), its folded poses, and Split View on the inner display. One layout adapts to all of them, and moving between them feels continuous. Source: Apple's HIG, "Designing for iPhone Duo".

**Layout**
- Lay out with size classes (`horizontalSizeClass`, `verticalSizeClass`), layout margins and safe areas.
- Never branch on `UIScreen.main`, device model, idiom or orientation, and use no fixed widths. The inner display ignores supported orientations.
- **Compact width:** one pane.
- **Regular width:** one extra level of hierarchy, for example a list beside its detail. Use `NavigationSplitView`, or `ArrangementView` for two views side by side or overlaid. Navigation containers go around arrangement views, never inside them.

**Bars and controls**
- Use the system tab bar, toolbars and navigation bars, and let iPhone Duo move them to the side.
- Never assume a bottom tab bar. Anything that points at a control (coach marks, tooltips) anchors to that control's real frame (`anchorPreference`), not to a screen edge.
- Group toolbar items with `ToolbarItemGroup`, give each a title and a symbol (`Label`), and set visibility priorities so the important ones survive overflow.
- Keep custom overlays and key controls out of reserved regions (the fold, the cameras) with `ReservedRegion`.

**Transitions and state**
- When the device folds, move only what has to move. Avoid big rearrangements.
- Every size keeps the same functions and the same state. State lives in the `@Observable` model, not in view-local `@State`. Folding, unfolding, rotating or entering Split View never resets a step, a scroll position, a draft or a running animation.
- Animate size changes (`.animation(_:value:)` keyed on the size class, `matchedGeometryEffect` for elements that move) instead of jumping.

**Capabilities and text size**
- Check capabilities, not devices. Permissions can be denied or limited (When-In-Use location only, notifications off), and features can be missing. Each screen has a "not available" path that still lets the person finish.
- Dynamic Type up to the accessibility sizes must not clip or overlap at any width.

## Proof

`npm run agent:ios:ready -- --deeplink crewcue://dev/<id>`. QA loop: `.claude/rules/mobile-simulator-agent-qa.md`.
