package com.crewcue.android.ui.onboarding

import android.Manifest
import android.content.ActivityNotFoundException
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import com.crewcue.android.ui.ShellTab
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.SecondaryButton
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * The measured frames of the controls a coach mark can point at (`crewcue.tab.*`), in window px.
 * The tab bar reports them with [onGloballyPositioned], so a card follows the bar wherever the
 * layout puts it (bottom, side, a rail).
 */
class TourAnchors {
    val frames = mutableStateMapOf<String, Rect>()
}

/** Records this control's frame for coach marks under [tag]. */
fun Modifier.tourAnchor(anchors: TourAnchors?, tag: String): Modifier =
    if (anchors == null) this else onGloballyPositioned { coordinates ->
        val origin = coordinates.positionInWindow()
        val size = coordinates.size
        val frame = Rect(origin.x, origin.y, origin.x + size.width, origin.y + size.height)
        // Only a moved frame is written: every write to the map recomposes the overlay.
        if (anchors.frames[tag] != frame) anchors.frames[tag] = frame
    }

/**
 * The tour's coach mark over the shell: the screen dims, a ring sits on the card's tab, the card
 * goes where [CoachMarkLayout] finds room, and the card's tab opens under it ([onSelectTab]).
 * Handles each card's action: the invite share, the notification prompt, the location test and
 * the start-line zoom ([onStartLine]).
 */
@Composable
fun TourOverlayHost(
    tour: OnboardingTourViewModel,
    anchors: TourAnchors,
    onSelectTab: (ShellTab) -> Unit,
    onStartLine: () -> Unit,
    modifier: Modifier = Modifier
) {
    val card = tour.card ?: return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(card.step) {
        card.anchorTab?.let(onSelectTab)
        if (card.action == "showStartLine") onStartLine()
    }
    // Notifications allowed in Settings meanwhile: the card says so when the app comes back.
    var notificationsOn by remember(card.step) { mutableStateOf(tour.notificationsAllowed()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    androidx.compose.runtime.DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) notificationsOn = tour.notificationsAllowed()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        tour.notificationsAnswered(card.step, granted)
    }
    val background = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) tour.locationPermission("always")
    }
    val fine = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) {
            tour.locationPermission("denied")
            return@rememberLauncherForActivityResult
        }
        tour.locationPermission("whenInUse")
        askBackground(background)
    }
    val location = tour.location.takeIf { card.step == "location" }
    val primaryLabel: String? = when {
        card.action == "enableNotifications" && notificationsOn -> tour.text.next
        card.action == "testTracking" && location != null -> location.primaryLabel
        else -> card.primaryLabel
    }
    val secondaryLabel: String? = when {
        card.action == "enableNotifications" && notificationsOn -> null
        card.action == "shareInvite" && tour.inviteShared -> tour.text.next
        card.action == "testTracking" && location != null -> location.secondaryLabel
        else -> card.secondaryLabel
    }
    val status: Pair<String, String>? = when {
        card.action == "enableNotifications" && notificationsOn -> TOUR_NOTIFICATIONS_STATUS_TAG to tour.text.notificationsOn
        card.action == "testTracking" -> location?.message?.let { TOUR_LOCATION_STATUS_TAG to it }
        card.action == "shareInvite" && tour.busy -> TOUR_INVITE_STATUS_TAG to tour.text.inviteLoading
        else -> null
    }
    fun primary() {
        when (card.action) {
            "shareInvite" -> {
                if (tour.isDev) {
                    tour.noteInviteShared()
                    return
                }
                scope.launch {
                    val intent = tour.inviteIntent(card.title) ?: return@launch
                    try {
                        context.startActivity(intent)
                        tour.noteInviteShared()
                    } catch (_: ActivityNotFoundException) {
                        tour.noteInviteShared()
                    }
                }
            }
            "enableNotifications" -> when {
                notificationsOn -> tour.notificationsAnswered(card.step, true)
                Build.VERSION.SDK_INT >= 33 -> notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                else -> tour.notificationsAnswered(card.step, true)
            }
            "testTracking" -> {
                if (location?.phase == "sent") {
                    tour.locationNext(card.step)
                    return
                }
                tour.startLocationTest {
                    if (tour.isDev) return@startLocationTest
                    if (tour.fineGranted()) {
                        tour.locationPermission(if (tour.locationAlways()) "always" else "whenInUse")
                        if (!tour.locationAlways()) askBackground(background)
                    } else {
                        fine.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                    }
                }
            }
            else -> tour.answer(card.step)
        }
    }
    fun secondary() {
        when {
            card.action == "shareInvite" && tour.inviteShared -> tour.answer(card.step, outcome = "done")
            card.action == "testTracking" -> tour.locationRaceMorning(card.step)
            else -> tour.answer(card.step, outcome = card.secondaryOutcome ?: "skipped")
        }
    }
    CoachMarkOverlay(
        card = card,
        anchor = card.anchorTag?.let { anchors.frames[it] },
        rootTag = if (card.role == "crew") CREW_TOUR_TAG else RUNNER_TOUR_TAG,
        primaryLabel = primaryLabel,
        secondaryLabel = secondaryLabel,
        status = status,
        busy = tour.busy,
        onPrimary = ::primary,
        onSecondary = ::secondary,
        onSkip = tour::skipTour,
        modifier = modifier
    )
}

/** Android 10+ asks for "Allow all the time" on its own, after location is allowed. */
private fun askBackground(background: androidx.activity.result.ActivityResultLauncher<String>) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) background.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
}

/**
 * The dim, the ring on [anchor] (window px) and the card, placed by [CoachMarkLayout] inside the
 * safe drawing area and off a fold's hinge. Taps on the dim do nothing: the card's buttons move on.
 */
@Composable
fun CoachMarkOverlay(
    card: TourCard,
    anchor: Rect?,
    rootTag: String,
    primaryLabel: String?,
    secondaryLabel: String?,
    status: Pair<String, String>?,
    busy: Boolean,
    onPrimary: () -> Unit,
    onSecondary: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val insets = WindowInsets.safeDrawing
    var origin by remember { mutableStateOf(Offset.Zero) }
    val hinges = currentWindowAdaptiveInfo().windowPosture.hingeList
        .filter { it.isSeparating || it.isOccluding }
        .map { it.bounds }
    val local = anchor?.translate(-origin.x, -origin.y)
    val ring = with(density) { 6.dp.toPx() }
    val scrim = Color.Black.copy(alpha = 0.55f)
    val ringColor = MaterialTheme.colorScheme.primaryContainer
    Box(
        modifier
            .fillMaxSize()
            .testTag(rootTag)
            .semantics { contentDescription = card.title }
            .onGloballyPositioned { origin = it.positionInWindow() }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
    ) {
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
        ) {
            drawRect(scrim)
            if (local != null) {
                val hole = local.inflate(ring)
                val corner = CornerRadius(hole.height / 2, hole.height / 2)
                drawRoundRect(Color.Transparent, hole.topLeft, hole.size, corner, blendMode = BlendMode.Clear)
                drawRoundRect(ringColor, hole.topLeft, hole.size, corner, style = Stroke(width = ring / 2))
            }
        }
        Layout(
            content = {
                AnimatedContent(
                    targetState = card,
                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                    contentKey = { it.step },
                    label = "tour card"
                ) { shown ->
                    TourCardView(shown, primaryLabel, secondaryLabel, status, busy, onPrimary, onSecondary, onSkip)
                }
            },
            modifier = Modifier.fillMaxSize()
        ) { measurables, constraints ->
            val width = constraints.maxWidth.toFloat()
            val height = constraints.maxHeight.toFloat()
            val margin = 16.dp.toPx()
            val safe = Rect(
                insets.getLeft(this, direction) + margin,
                insets.getTop(this) + margin,
                width - insets.getRight(this, direction) - margin,
                height - insets.getBottom(this) - margin
            )
            val measurable = measurables.first()
            val placement = CoachMarkLayout.place(
                safe = safe,
                anchor = local?.inflate(ring),
                maxCardWidth = 440.dp.toPx(),
                gap = 12.dp.toPx(),
                minBesideWidth = 240.dp.toPx(),
                avoid = hinges.map { it.translate(-origin.x, -origin.y) },
                heightFor = { measurable.maxIntrinsicHeight(it.roundToInt()).toFloat() }
            )
            val cardWidth = placement.width.roundToInt().coerceAtLeast(0)
            val placeable = measurable.measure(
                Constraints(
                    minWidth = cardWidth,
                    maxWidth = cardWidth,
                    minHeight = 0,
                    maxHeight = placement.maxHeight.roundToInt().coerceAtLeast(0)
                )
            )
            layout(constraints.maxWidth, constraints.maxHeight) {
                placeable.place(placement.x.roundToInt(), placement.y.roundToInt())
            }
        }
    }
}

@Composable
private fun TourCardView(
    card: TourCard,
    primaryLabel: String?,
    secondaryLabel: String?,
    status: Pair<String, String>?,
    busy: Boolean,
    onPrimary: () -> Unit,
    onSecondary: () -> Unit,
    onSkip: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(card.tag)
            .animateContentSize(),
        shape = RoundedCornerShape(28.dp),
        color = colors.surfaceContainerLowest,
        shadowElevation = 12.dp
    ) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(card.progressLabel, style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
            Text(
                card.title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() }
            )
            Text(card.body, style = MaterialTheme.typography.bodyLarge)
            if (card.example.isNotEmpty()) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = colors.surfaceContainer,
                    modifier = Modifier.fillMaxWidth().testTag(TOUR_EXAMPLE_TAG)
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        card.exampleHeading?.let {
                            Text(it.uppercase(), style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                        }
                        card.example.forEach { line ->
                            Text("${line.label}: ${line.value}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
            if (status != null) {
                Text(
                    status.second,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.primary,
                    modifier = Modifier.testTag(status.first).semantics { contentDescription = status.second }
                )
            }
            if (primaryLabel != null) {
                PrimaryButton(primaryLabel, onClick = onPrimary, modifier = Modifier.testTag(TOUR_PRIMARY_TAG), busy = busy)
            }
            if (secondaryLabel != null) {
                SecondaryButton(secondaryLabel, onClick = onSecondary, modifier = Modifier.testTag(TOUR_SECONDARY_TAG))
            }
            card.skipLabel?.let { skip ->
                TextButton(
                    onClick = onSkip,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(TOUR_SKIP_TAG)
                        .semantics { contentDescription = skip }
                ) {
                    Text(skip, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}
