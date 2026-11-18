package com.crewcue.android.ui.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.AdaptStrategy
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.HingePolicy
import androidx.compose.material3.adaptive.layout.PaneAdaptedValue
import androidx.compose.material3.adaptive.layout.SupportingPaneScaffold
import androidx.compose.material3.adaptive.layout.SupportingPaneScaffoldDefaults
import androidx.compose.material3.adaptive.layout.SupportingPaneScaffoldRole
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth
import androidx.compose.material3.adaptive.navigation.rememberSupportingPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.window.core.layout.WindowSizeClass
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.billing.BillingUiState
import com.crewcue.android.ui.billing.BillingViewModel
import com.crewcue.android.ui.billing.BillingViewModelFactory
import com.crewcue.android.ui.brand.CairnLoader
import com.crewcue.android.ui.chat.ChatContent
import com.crewcue.android.ui.chat.ChatViewModel
import com.crewcue.android.ui.chat.ChatViewModelFactory
import com.crewcue.android.ui.findActivity
import com.crewcue.android.ui.map.CourseFraming
import com.crewcue.android.ui.map.MapContent
import com.crewcue.android.ui.map.MapViewModel
import com.crewcue.android.ui.map.MapViewModelFactory
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.pace.LockedRowText
import com.crewcue.android.ui.pace.PaceContent
import com.crewcue.android.ui.pace.PaceViewModel
import com.crewcue.android.ui.pace.PaceViewModelFactory
import com.crewcue.android.ui.theme.CrewProgressBar
import com.crewcue.android.ui.theme.Kicker
import com.crewcue.android.ui.theme.LocalCrewExtras
import com.crewcue.android.ui.theme.ProductCard

/**
 * The onboarding preview step (`onboarding-race-preview`): the race-day replay on the runner's own
 * course, then the paywall. The stage, the replay clock and the beat live in [RacePreviewViewModel],
 * so nothing here restarts on a fold, a resize or a rotation.
 */
@Composable
fun RacePreviewRoute(shell: ShellViewModel) {
    val text = shell.onboardingText
    val source = shell.racePreviewSource()
    if (source == null) {
        // The race isn't known yet (the session is loading it): a loader with the screen's id.
        Box(Modifier.fillMaxSize().testTag(RACE_PREVIEW_TAG).semantics { contentDescription = text.title(PREVIEW_STEP) }) {
            SetupLoader(racePreviewTag("loading"))
        }
        return
    }
    val model: RacePreviewViewModel = viewModel(
        key = "race-preview",
        factory = viewModelFactory {
            initializer {
                RacePreviewViewModel(
                    runtime = BridgeRacePreviewRuntime(shell.container.raceDay, shell.container.cacheDirPath, shell::onboardingRaceContext),
                    rooms = shell.container.replayRooms,
                    savedState = createSavedStateHandle(),
                    background = shell.container.appScope
                )
            }
        }
    )
    LaunchedEffect(model, source.key) { model.show(source) }
    LaunchedEffect(model) { model.effects.collect(shell::onRacePreviewEffect) }
    // It plays only while on screen and in the foreground; a fold or rotation pauses it only for
    // the moment the activity is recreated.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(model, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> model.setWatched(true)
                Lifecycle.Event.ON_STOP -> model.setWatched(false)
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            model.setWatched(false)
        }
    }
    AnimatedContent(
        targetState = model.stage,
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "race-preview-stage"
    ) { stage ->
        when (stage) {
            RacePreviewStage.Replay -> ReplayScreen(model, shell, text)
            RacePreviewStage.Paywall -> OnboardingPaywall(model, shell, source, text)
        }
    }
}

// MARK: Replay

/**
 * The replay (`crewcue.onboarding-race-preview`): about 25 s on the runner's course in the real Map,
 * Pace and Chat views, each beat captioned, with Play/Pause and Skip always on screen.
 *
 * One composition at every size: the Map is always the main pane's view, so a fold or a resize
 * never moves it. Compact width: one view at a time over it, following the beats (Map, Pace, Map
 * for the dead zone, then Chat), with a Map/Pace/Chat strip. Medium and expanded: Pace beside the
 * Map in the supporting pane, and Chat in its place at its beat, split off any vertical hinge.
 * Tabletop: the views above the fold, the controls and caption below it.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
private fun ReplayScreen(model: RacePreviewViewModel, shell: ShellViewModel, text: OnboardingText) {
    val info = currentWindowAdaptiveInfo()
    val tabletop = info.windowPosture.isTabletop
    val panes = calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth(info, HingePolicy.AlwaysAvoid)
    val playing = model.status == RacePreviewStatus.Playing && model.replay != null
    // One pane while there is nothing to put beside the Map, or in tabletop (split at the fold instead).
    val directive = if (tabletop || !playing) panes.copy(maxHorizontalPartitions = 1) else panes
    val navigator = rememberSupportingPaneScaffoldNavigator(
        scaffoldDirective = directive,
        adaptStrategies = SupportingPaneScaffoldDefaults.adaptStrategies(supportingPaneAdaptStrategy = AdaptStrategy.Hide)
    )
    val split = navigator.scaffoldValue[SupportingPaneScaffoldRole.Supporting] != PaneAdaptedValue.Hidden
    val title = text.title(PREVIEW_STEP)
    // Moves between the flat layout and tabletop's top half without losing the Map.
    val views = remember(model) { movableContentOf { splitNow: Boolean -> ReplayViewsArea(model, shell, text, splitNow) } }
    Box(
        Modifier
            .fillMaxSize()
            .testTag(RACE_PREVIEW_TAG)
            .semantics { contentDescription = title }
    ) {
        SupportingPaneScaffold(
            directive = navigator.scaffoldDirective,
            value = navigator.scaffoldValue,
            mainPane = {
                AnimatedPane(Modifier.testTag(racePreviewTag("pane.main"))) {
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        val captionMax = maxHeight * CAPTION_SHARE
                        FoldSplit(
                            posture = info.windowPosture.takeIf { tabletop },
                            top = { views(split) },
                            bottom = {
                                Column(Modifier.fillMaxSize()) {
                                    ReplayControls(model, text)
                                    if (model.status == RacePreviewStatus.Playing || model.fromSavedRace) {
                                        ReplayCaption(model, text, title, Modifier.heightIn(max = captionMax))
                                    }
                                    if (!tabletop) {
                                        Box(Modifier.weight(1f).fillMaxWidth()) { views(split) }
                                    }
                                }
                            }
                        )
                    }
                }
            },
            supportingPane = {
                AnimatedPane(Modifier.testTag(racePreviewTag("pane.supporting"))) {
                    model.replay?.let { replay -> SupportingView(model, replay, shell, text) }
                }
            }
        )
    }
}

/** The main pane's views: the Map (and, on a compact width, the beat's view over it), or the replay's state. */
@Composable
private fun ReplayViewsArea(model: RacePreviewViewModel, shell: ShellViewModel, text: OnboardingText, split: Boolean) {
    val replay = model.replay
    when {
        model.status == RacePreviewStatus.Playing && replay != null -> ReplayPanels(model, replay, shell, text, split)
        model.status == RacePreviewStatus.Playing || model.status == RacePreviewStatus.Loading -> ReplayLoading(text)
        else -> ReplayMessage(
            text.title(PREVIEW_STEP),
            when (model.status) {
                RacePreviewStatus.Empty -> text.replay.empty
                RacePreviewStatus.Offline -> text.replay.offline
                else -> text.replay.error
            }
        )
    }
}

@Composable
private fun ReplayPanels(
    model: RacePreviewViewModel,
    replay: RacePreviewReplay,
    shell: ShellViewModel,
    text: OnboardingText,
    split: Boolean
) {
    val views = rememberReplayViews(replay, shell)
    // Each step reads the scripted runner at once, instead of the 30 s poll.
    LaunchedEffect(views, model.stepIndex) { views.map.refreshNow() }
    Column(Modifier.fillMaxSize()) {
        if (!split) PanelStrip(model, text)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val covered = !split && model.panel != ReplayPanel.Map
            Box(Modifier.fillMaxSize().then(if (covered) Modifier.clearAndSetSemantics {} else Modifier)) {
                MapContent(
                    views.map,
                    replay.roomId,
                    focus = "map-track",
                    bottomInset = 8.dp,
                    underTopBar = false,
                    framing = CourseFraming.Replay
                )
            }
            if (covered) {
                // An opaque surface over the Map, which also keeps touches off it.
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    PanelView(model.panel, views, replay, text)
                }
            }
        }
    }
}

/** Medium and expanded: Pace beside the Map, or Chat at its beat. */
@Composable
private fun SupportingView(model: RacePreviewViewModel, replay: RacePreviewReplay, shell: ShellViewModel, text: OnboardingText) {
    val views = rememberReplayViews(replay, shell)
    AnimatedContent(
        targetState = if (model.panel == ReplayPanel.Chat) ReplayPanel.Chat else ReplayPanel.Pace,
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "replay-supporting"
    ) { panel -> PanelView(panel, views, replay, text) }
}

@Composable
private fun PanelView(panel: ReplayPanel, views: ReplayViews, replay: RacePreviewReplay, text: OnboardingText) {
    val locked = LockedRowText(text.replay.lockedRow.ifBlank { text.label("locked") }, text.replay.lockedExplanation)
    when (panel) {
        ReplayPanel.Map -> MapContent(views.map, replay.roomId, focus = "map-track", underTopBar = false, framing = CourseFraming.Replay)
        ReplayPanel.Pace -> PaceContent(
            views.pace,
            replay.roomId,
            modifier = Modifier.navigationBarsPadding(),
            race = views.map,
            locked = locked
        )
        ReplayPanel.Chat -> ChatContent(
            views.chat,
            replay.roomId,
            raceName = views.map.raceName,
            modifier = Modifier.navigationBarsPadding(),
            race = views.map,
            readOnly = true
        )
    }
}

/** The replay's own Map, Pace and Chat models, on a second bridge bound to its runtime. */
private class ReplayViews(val map: MapViewModel, val pace: PaceViewModel, val chat: ChatViewModel)

/**
 * The models live in [RacePreviewReplay.models], cleared when the replay ends. Their bridge is on
 * the replay's base URL with no token and no role: they read the replay, never the API, and the
 * read-only models attempt no write.
 */
@Composable
private fun rememberReplayViews(replay: RacePreviewReplay, shell: ShellViewModel): ReplayViews {
    val owner = remember(replay) { ReplayModelsOwner(replay.models) }
    val bridge = remember(replay) { shell.container.raceDay.replay(replay.baseUrl, replay.viewerUserId) }
    val map: MapViewModel = viewModel(
        viewModelStoreOwner = owner,
        key = "replay-map",
        factory = MapViewModelFactory(bridge, replay.roomId, role = "", readOnly = true)
    )
    val pace: PaceViewModel = viewModel(
        viewModelStoreOwner = owner,
        key = "replay-pace",
        factory = PaceViewModelFactory(bridge, replay.roomId, readOnly = true)
    )
    val chat: ChatViewModel = viewModel(
        viewModelStoreOwner = owner,
        key = "replay-chat",
        factory = ChatViewModelFactory(bridge, replay.roomId)
    )
    return remember(map, pace, chat) { ReplayViews(map, pace, chat) }
}

private class ReplayModelsOwner(override val viewModelStore: ViewModelStore) : ViewModelStoreOwner

/** Play or pause, the replay's progress and Skip: always on screen, at any text size. */
@Composable
private fun ReplayControls(model: RacePreviewViewModel, text: OnboardingText) {
    val colors = MaterialTheme.colorScheme
    val canPlay = model.status == RacePreviewStatus.Playing && model.replay != null
    val label = if (model.pausedByUser) text.replay.play else text.replay.pause
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        FilledTonalIconButton(
            onClick = model::togglePlay,
            enabled = canPlay,
            modifier = Modifier
                .size(48.dp)
                .testTag(racePreviewTag("play-pause"))
                .semantics { contentDescription = label }
        ) {
            Icon(if (model.pausedByUser) Icons.Filled.PlayArrow else Icons.Filled.Pause, contentDescription = null)
        }
        val progress by animateFloatAsState(model.progress.toFloat(), animationSpec = tween(STEP_ANIMATION_MILLIS), label = "replay-progress")
        CrewProgressBar(
            progress,
            Modifier
                .weight(1f)
                .semantics { contentDescription = text.title(PREVIEW_STEP) },
            height = 6.dp
        )
        OutlinedButton(
            onClick = model::skip,
            enabled = !model.finishing,
            modifier = Modifier
                .heightIn(min = 48.dp)
                .testTag(racePreviewTag("skip"))
                .semantics { contentDescription = text.replay.skip },
            shape = CircleShape,
            border = BorderStroke(1.5.dp, colors.outline)
        ) {
            Text(text.replay.skip, style = MaterialTheme.typography.labelLarge, color = colors.onSurface)
        }
    }
}

/**
 * The beat's caption, "n of 4", and offline where the race came from. Every caption is laid out,
 * hidden, so the card keeps the longest one's height and the views under it don't move at each
 * beat; past [modifier]'s height (the largest text sizes, a short pane) it scrolls.
 */
@Composable
private fun ReplayCaption(model: RacePreviewViewModel, text: OnboardingText, title: String, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 8.dp)
            .verticalScroll(rememberScrollState())
    ) {
        ProductCard(
            Modifier
                .testTag(racePreviewTag("caption"))
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            padding = androidx.compose.foundation.layout.PaddingValues(16.dp)
        ) {
            if (model.status == RacePreviewStatus.Playing) {
                Kicker(title, modifier = Modifier.semantics { heading() })
                Text(
                    model.beatLabel,
                    modifier = Modifier.padding(top = 4.dp).testTag(racePreviewTag("beat")),
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.primary
                )
                Box(Modifier.padding(top = 6.dp)) {
                    text.replay.captions.forEach { caption ->
                        Text(
                            caption,
                            modifier = Modifier.alpha(0f).clearAndSetSemantics {},
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                    AnimatedContent(targetState = model.caption, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "replay-caption") { caption ->
                        Text(caption, style = MaterialTheme.typography.bodyLarge, color = colors.onSurface)
                    }
                }
            }
            if (model.fromSavedRace) {
                Text(
                    text.replay.offline,
                    modifier = Modifier.padding(top = 8.dp).testTag(racePreviewTag("offline")),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant
                )
            }
        }
    }
}

/** Compact width: Map, Pace or Chat, the tab bar's own names. */
@Composable
private fun PanelStrip(model: RacePreviewViewModel, text: OnboardingText) {
    SingleChoiceSegmentedButtonRow(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 8.dp)
            .testTag(racePreviewTag("panel"))
    ) {
        ReplayPanel.entries.forEachIndexed { index, panel ->
            SegmentedButton(
                selected = model.panel == panel,
                onClick = { model.selectPanel(panel) },
                shape = SegmentedButtonDefaults.itemShape(index, ReplayPanel.entries.size),
                modifier = Modifier.testTag(racePreviewTag("panel.${panel.name.lowercase()}"))
            ) {
                Text(text.replay.panelTitle(panel))
            }
        }
    }
}

/** The replay can't play: no course, an error, or offline with nothing saved. Skip stays above. */
@Composable
private fun ReplayMessage(title: String, message: String) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        ProductCard {
            Kicker(title, modifier = Modifier.semantics { heading() })
            Text(
                message,
                modifier = Modifier.padding(top = 6.dp).testTag(racePreviewTag("status")),
                style = MaterialTheme.typography.bodyLarge
            )
        }
    }
}

@Composable
private fun ReplayLoading(text: OnboardingText) {
    Box(
        Modifier
            .fillMaxSize()
            .testTag(racePreviewTag("loading"))
            .semantics { contentDescription = text.replay.loading },
        contentAlignment = Alignment.Center
    ) {
        CairnLoader(modifier = Modifier.size(64.dp), onLight = !LocalCrewExtras.current.dark)
    }
}

// MARK: Paywall

/**
 * The paywall that ends the replay (`crewcue.onboarding-paywall`): "You + 1 crew" (Race Pass) and
 * "Your whole crew" (Race Pass + Full Crew), each with the store's localized price (the
 * `BillingProduct` fallback until it answers). The existing purchase path buys; only the server's
 * billing read unlocks the race, which then marks the step done. Not now skips the step and lands
 * on the tab bar behind Unlock race; Back (the button, system or predictive back) replays from the
 * start. The dev route's fixture has no race to buy, so it shows the fallback prices only.
 */
@Composable
private fun OnboardingPaywall(model: RacePreviewViewModel, shell: ShellViewModel, source: RacePreviewSource, text: OnboardingText) {
    val roomId = (source as? RacePreviewSource.Race)?.roomId
    val billing = roomId?.let { rememberOnboardingBilling(shell, it) }
    val context = LocalContext.current
    val activity = context.findActivity()
    LaunchedEffect(billing) { billing?.load(context.isOnline()) }
    val unlocked = billing != null && ((billing.state as? BillingUiState.Success)?.unlocked == true || billing.billing?.isPaid == true)
    LaunchedEffect(unlocked) { if (unlocked) model.purchased() }
    val busy = billing?.busy == true || model.finishing
    BackHandler(enabled = !busy) { model.replayFromStart() }
    val windowClass = currentWindowAdaptiveInfo().windowSizeClass
    val sideBySide = windowClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND) &&
        LocalDensity.current.fontScale < LARGE_FONT_SCALE
    val colors = MaterialTheme.colorScheme
    Column(
        Modifier
            .fillMaxSize()
            .testTag(ONBOARDING_PAYWALL_TAG)
            .semantics { contentDescription = text.title(PAYWALL_STEP) }
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Column(Modifier.widthIn(max = 960.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            TextButton(
                onClick = model::replayFromStart,
                enabled = !busy,
                modifier = Modifier.testTag(onboardingPaywallTag("back")).semantics { contentDescription = text.replay.back }
            ) { Text(text.replay.back, style = MaterialTheme.typography.labelLarge) }
            Text(
                text.title(PAYWALL_STEP),
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.displaySmall,
                color = colors.onSurface
            )
            text.explanation(PAYWALL_STEP).takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyLarge, color = colors.onSurfaceVariant)
            }
            Text(text.replay.pitch, style = MaterialTheme.typography.bodyLarge, color = colors.onSurface)
            val options = text.replay.options
            if (sideBySide) {
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    options.forEach { option ->
                        PaywallOptionCard(option, text, billing, activity, Modifier.weight(1f).fillMaxHeight())
                    }
                }
            } else {
                options.forEach { option -> PaywallOptionCard(option, text, billing, activity, Modifier.fillMaxWidth()) }
            }
            billing?.state?.message?.takeIf { it.isNotBlank() }?.let { line ->
                val error = billing.state is BillingUiState.Error || billing.state is BillingUiState.Offline
                Text(
                    line,
                    modifier = Modifier.testTag(onboardingPaywallTag("status")).semantics { contentDescription = line },
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (error) colors.error else colors.onSurface
                )
            }
            if (billing != null) {
                SetupSecondaryButton(
                    REDEEM_CODE,
                    onboardingPaywallTag("redeem"),
                    onClick = { billing.redeem(activity, context.isOnline()) },
                    enabled = !busy && !unlocked
                )
            }
            SetupSecondaryButton(text.replay.notNow, onboardingPaywallTag("not-now"), onClick = model::notNow, enabled = !busy)
        }
    }
}

@Composable
private fun PaywallOptionCard(
    option: PaywallOption,
    text: OnboardingText,
    billing: BillingViewModel?,
    activity: android.app.Activity?,
    modifier: Modifier
) {
    val context = LocalContext.current
    val price = billing?.prices?.get(option.product) ?: option.fallbackPrice
    val forThisCard = billing?.busyProduct == option.product
    val paid = billing?.billing?.isPaid == true
    ProductCard(
        modifier
            .testTag(option.tag)
            .semantics(mergeDescendants = false) { contentDescription = option.title }
    ) {
        Text(option.title, modifier = Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge)
        Text(
            option.detail,
            modifier = Modifier.padding(top = 6.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Box(Modifier.padding(top = 16.dp)) {
            SetupPrimaryButton(
                "${option.productTitle} · $price",
                "${option.tag}.buy",
                onClick = { billing?.buy(activity, option.product, context.isOnline()) },
                enabled = billing != null && !billing.busy && !paid,
                busy = forThisCard,
                spoken = text.replay.buyLabel(option, price)
            )
        }
    }
}

/** The existing purchase model (`BillingViewModel`), for this race, in this route's store. */
@Composable
private fun rememberOnboardingBilling(shell: ShellViewModel, roomId: String): BillingViewModel {
    val copy = remember(shell) { shell.billingCopy() }
    return viewModel(
        key = "onboarding-paywall-$roomId",
        factory = BillingViewModelFactory(shell.container.raceDay, shell.container.storePurchaser, roomId, copy)
    )
}

/** client-core `OnboardingStep.paywall`. */
private const val PAYWALL_STEP = "paywall"
/** The paywall's existing redeem action, as the Race Pass screen labels it. */
private const val REDEEM_CODE = "Redeem code"
/** The caption card's most of the main pane, past which it scrolls. */
private const val CAPTION_SHARE = 0.4f
/** At or past this font scale the paywall stacks its options at any width. */
private const val LARGE_FONT_SCALE = 1.3f
private const val STEP_ANIMATION_MILLIS = 500
