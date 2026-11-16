---
description: Compose presentation structure for apps/android
paths:
  - "apps/android/**"
---

# Android presentation

Same responsibilities as iOS, in Compose. Use this when a screen does more than render a fixture. A bugfix inside an existing fixture view does not restructure the shell.

- `ViewModel` plus a `sealed` `UiState` that mirrors the shared state enum and `UserFacingError`. The ViewModel calls Swift.
- `di/AppContainer.kt` builds dependencies.
- `nav/AppRouter.kt` is a `NavHost` using the same route ids as client-core `Route`.
- `logging/AndroidLogger.kt` adapts `android.util.Log`. Coroutines only. No `GlobalScope`. No new policy `object`s. `ClientCoreBridge` stays the JNI edge.
- `ui/<feature>/` holds the ViewModel and composable. Test tag is `crewcue.<feature>`. `contentDescription` is a human label, separate from the test id.
- SDK pockets (MapLibre, Auth0, Firebase Messaging) stay in the app module.
- Shared policy, errors, and routes: `.claude/rules/client-core-architecture.md`.

## Adaptive layout (every new or reworked screen)

The app runs at any size the system gives it: phones, foldables (folded, unfolded, half-open), tablets, multi-window and desktop windowing. With targetSdk 36, Android 16 ignores orientation and resizability locks on large screens, so there is no opting out. One layout adapts to all of these, with continuous transitions.

**Layout**
- Branch on the window size class (`currentWindowAdaptiveInfo().windowSizeClass`, from `androidx.compose.material3.adaptive`). Never branch on device model, screen size or orientation.
- No `screenOrientation`, no `resizeableActivity="false"`, no fixed widths.
- **Compact:** one pane.
- **Medium and expanded:** one extra level of hierarchy, using the Material 3 adaptive scaffolds: `ListDetailPaneScaffold`, `SupportingPaneScaffold`, and `NavigationSuiteScaffold` so the tab bar becomes a navigation rail.

**Folds**
- Read the fold posture (`currentWindowAdaptiveInfo().windowPosture`, which comes from Jetpack WindowManager's `FoldingFeature`). Keep content and controls off the hinge.
- In tabletop posture, put the content on the top half and the controls on the bottom half.

**Pointers**
- Anything that points at a control (coach marks, tooltips) anchors to the control's measured bounds (`onGloballyPositioned`), so it follows the tab bar when it becomes a rail.

**Transitions and state**
- State survives every configuration change and process death: `ViewModel` with `SavedStateHandle`, and `rememberSaveable` for UI-only state. Folding or resizing never resets a step, a scroll position, a draft or a running animation.
- Animate size changes (`AnimatedContent`, `animateContentSize`, the scaffolds' pane motion) instead of jumping.

**Capabilities and text size**
- Check capabilities, not devices. Permissions can be denied or partial (approximate location, no background location, notifications off), Google Play services can be missing (no FCM push), and hardware differs. Each screen has a "not available" path that still lets the person finish.
- Font scale up to 200% must not clip or overlap at any width.

## Proof

`npm run agent:android:ready -- --deeplink crewcue://dev/<id>`. QA loop: `.claude/rules/android-emulator-agent-qa.md`.
