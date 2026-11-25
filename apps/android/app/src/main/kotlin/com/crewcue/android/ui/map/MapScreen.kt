package com.crewcue.android.ui.map

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import com.crewcue.android.ui.theme.MetricStyle
import com.crewcue.android.ui.theme.PillButton
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.BuildConfig
import com.crewcue.android.ui.MapToolRequest
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.brand.CairnLoader
import com.crewcue.android.ui.theme.ChipStyle
import com.crewcue.android.ui.theme.CircleIconButton
import com.crewcue.android.ui.theme.CrewClock
import com.crewcue.android.ui.theme.CrewTextField
import com.crewcue.android.ui.theme.Kicker
import com.crewcue.android.ui.theme.LocalCrewExtras
import com.crewcue.android.ui.theme.MetricColumn
import com.crewcue.android.ui.theme.MetricLargeStyle
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.SecondaryButton
import com.crewcue.android.ui.theme.StatusChip

@Composable
fun MapScreen(
    shell: ShellViewModel,
    roomId: String,
    focus: String,
    modifier: Modifier = Modifier,
    bottomInset: Dp = 16.dp,
    /** Set on an unpaid race: Start tracking opens the paywall instead. */
    onLocked: (() -> Unit)? = null,
    /** A tool the shell opens (a tracking push opens Location, at Start tracking). */
    toolRequest: MapToolRequest? = null,
    /** Where the chips start under the shell's top bar, which grows with its course strip. */
    topInset: Dp = 76.dp
) {
    val role = shell.session?.role.orEmpty()
    val model: MapViewModel = viewModel(
        key = "map-$roomId-$role",
        factory = MapViewModelFactory(shell.container.raceDay, roomId, role)
    )
    MapContent(model, roomId, focus, modifier, bottomInset = bottomInset, onLocked = onLocked, toolRequest = toolRequest, topInset = topInset)
}

/**
 * The Map on a given [model]: the shell's race, or (a [MapViewModel.readOnly] model) the
 * onboarding replay's, which shows the course, the runner's path and the aid sheet with no map
 * tools, no tracking and nothing sent. [underTopBar]: the shell's floating top bar is above the
 * map, so the chips start below it; the replay draws the map in its own pane instead, framing
 * the course with [framing].
 *
 * Only the replay passes [glide] (its dot between pings, read on every frame it changes, never
 * recomposing this) and [pathPings] (the pings in its path, which the path chip counts instead of
 * the points the replay adds along the course). On the race Map the dot is the runner's latest
 * ping and the chip counts the path the API serves.
 */
@Composable
fun MapContent(
    model: MapViewModel,
    roomId: String,
    focus: String,
    modifier: Modifier = Modifier,
    bottomInset: Dp = 16.dp,
    onLocked: (() -> Unit)? = null,
    underTopBar: Boolean = true,
    framing: CourseFraming = CourseFraming.Screen,
    glide: (() -> RunnerGlideFrame?)? = null,
    pathPings: Int? = null,
    toolRequest: MapToolRequest? = null,
    topInset: Dp = 76.dp
) {
    LaunchedEffect(roomId) { model.load() }
    // Back from the lock screen or another app: read the runner now, not at the next tick.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    androidx.compose.runtime.DisposableEffect(lifecycle, model) {
        var started = false
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                if (started) model.refreshNow() else started = true
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    // A saved tracking session resumes when the app opens again (the service may have been killed).
    // The replay never tracks.
    val context = LocalContext.current
    LaunchedEffect(model.trackingActive) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (model.trackingActive && granted && !model.readOnly) RaceTrackingService.start(context)
    }
    var tool by remember(focus, toolRequest) {
        mutableStateOf(if (model.readOnly) "none" else toolRequest?.tool ?: mapTool(focus))
    }
    val rootTag = when (focus) {
        "map-checkpoint-pick" -> "crewcue.map-checkpoint-pick"
        "map-navigate" -> "crewcue.map-navigate"
        "location-heartbeat" -> "crewcue.location-heartbeat"
        else -> "crewcue.map"
    }
    val rootTitle = when (focus) {
        "map-checkpoint-pick" -> "Pick checkpoint"
        "map-navigate" -> "Navigate"
        "location-heartbeat" -> "Location"
        else -> "Map"
    }
    val showMap = focus != "location-heartbeat"
    Box(
        modifier
            .fillMaxSize()
            .testTag(rootTag)
            .semantics { contentDescription = rootTitle }
    ) {
        if (showMap) {
            CourseMapHost(
                points = model.checkpoints,
                line = model.line,
                track = model.track,
                onMapTap = model::onMapTap,
                onStyleReady = model::onStyleReady,
                onStyleFailed = model::onStyleFailed,
                onTilesUnavailable = model::onTilesUnavailable,
                recenterRequest = model.recenterRequest,
                modifier = Modifier.fillMaxSize(),
                framing = framing,
                trackTimes = if (glide != null) model.trackTimes else emptyList(),
                glide = glide
            )
            MapOverlay(
                model,
                onTool = { tool = it },
                underTopBar = underTopBar,
                pathPings = pathPings,
                topInset = topInset,
                modifier = Modifier.align(Alignment.TopStart)
            )
        }
        MapSheet(
            model = model,
            tool = tool,
            onCloseTool = { tool = "none" },
            fillHeight = !showMap,
            onLocked = onLocked,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 8.dp)
                .padding(bottom = bottomInset)
                .navigationBarsPadding()
        )
    }
}

/** Status chips and the round map controls under the shell top bar (or the replay pane's top). */
@Composable
private fun MapOverlay(
    model: MapViewModel,
    onTool: (String) -> Unit,
    underTopBar: Boolean,
    pathPings: Int?,
    topInset: Dp = 76.dp,
    modifier: Modifier = Modifier
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        modifier
            .fillMaxWidth()
            .then(if (underTopBar) Modifier.statusBarsPadding().padding(top = topInset) else Modifier.padding(top = 12.dp))
            .padding(start = 16.dp, end = 16.dp),
        verticalAlignment = Alignment.Top
    ) {
        val readout = model.readout
        if (readout.statusLabel.isNotBlank()) {
            StatusChip(readout.statusLabel, if (readout.status == "behind") ChipStyle.Soft else ChipStyle.Filled)
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            StatusChip(readout.pingLabel, ChipStyle.Surface, dot = readout.pingState == "live")
            // The runner's pings, as on a race: the replay's path adds points along the course between them.
            val count = if (model.track.isEmpty()) 0 else pathPings ?: model.track.size
            val trackLabel = if (count == 0) "NO PATH YET" else "PATH · $count ${if (count == 1) "POINT" else "POINTS"}"
            StatusChip(
                trackLabel,
                ChipStyle.Surface,
                modifier = Modifier
                    .testTag("crewcue.runner-track")
                    .semantics { contentDescription = if (count == 0) "No runner path yet" else "Runner path, $count points" }
            )
            CircleIconButton(Icons.Outlined.MyLocation, "Fit course", onClick = model::recenter)
            // Placing checkpoints, routes and tracking all write: not in the replay.
            if (!model.readOnly) Box {
                CircleIconButton(Icons.Outlined.Layers, "Map tools", onClick = { menu = true })
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    listOf(
                        "none" to "Aid stations",
                        "pick" to "Place checkpoint",
                        "navigate" to "Navigate",
                        "location" to "Tracking"
                    ).forEach { (id, label) ->
                        DropdownMenuItem(text = { Text(label) }, onClick = {
                            menu = false
                            onTool(id)
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun MapSheet(
    model: MapViewModel,
    tool: String,
    onCloseTool: () -> Unit,
    fillHeight: Boolean,
    onLocked: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .then(if (fillHeight) Modifier.fillMaxHeight() else Modifier.heightIn(max = 520.dp)),
        shape = RoundedCornerShape(topStart = 40.dp, topEnd = 40.dp, bottomStart = 32.dp, bottomEnd = 32.dp),
        color = colors.surfaceContainerLowest.copy(alpha = 0.97f),
        shadowElevation = 8.dp
    ) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(bottom = 16.dp)
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button) { expanded = !expanded }
                    .padding(top = 10.dp, bottom = 12.dp)
                    .semantics { contentDescription = if (expanded) "Collapse details" else "Expand details" },
                contentAlignment = Alignment.Center
            ) {
                Box(Modifier.size(width = 44.dp, height = 5.dp).background(colors.outline.copy(alpha = 0.45f), CircleShape))
            }
            if (tool == "none") {
                AidContent(model, expanded)
            } else {
                ToolContent(model, tool, onCloseTool, onLocked)
            }
            if (!BuildConfig.MAP_LIBRE && BuildConfig.MAP_LIBRE_ERROR.isNotBlank()) {
                Text(BuildConfig.MAP_LIBRE_ERROR, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            }
        }
    }
}

@Composable
private fun AidContent(model: MapViewModel, expanded: Boolean) {
    val banner = mapBanner(model)
    if (model.aidPages.isEmpty()) {
        Column(Modifier.padding(horizontal = 24.dp)) {
            Kicker("Next aid station", color = MaterialTheme.colorScheme.primary)
            Text(
                banner ?: "No aid stations yet.",
                modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = banner ?: "No aid stations yet." },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        return
    }
    AidPager(model)
    if (banner != null) {
        Text(
            banner,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp).semantics { contentDescription = banner },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
    if (expanded) {
        Column(Modifier.padding(horizontal = 24.dp).padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // The whole race, whichever aid the pager shows. Course progress is in the top bar.
            Row(
                Modifier.semantics(mergeDescendants = true) {}.testTag("crewcue.aid-race-stats"),
                verticalAlignment = Alignment.CenterVertically
            ) {
                MetricColumn("Race time", model.readout.elapsedLabel, Modifier.weight(1f), compact = true)
                VerticalDivider(Modifier.height(40.dp), color = MaterialTheme.colorScheme.outlineVariant)
                MetricColumn("Avg pace", model.readout.averagePaceLabel, Modifier.weight(1f), compact = true)
            }
            if (model.aidShowsBackToNext) {
                PillButton(
                    "Back to next aid",
                    onClick = model::jumpToNextAid,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                    icon = Icons.AutoMirrored.Outlined.Undo
                )
            }
        }
    }
}

@Composable
private fun ToolContent(model: MapViewModel, tool: String, onClose: () -> Unit, onLocked: (() -> Unit)?) {
    val title = when (tool) {
        "pick" -> "Place checkpoint"
        "navigate" -> "Navigate"
        else -> "Tracking"
    }
    Column(Modifier.padding(horizontal = 24.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            IconButton(
                onClick = onClose,
                modifier = Modifier
                    .size(40.dp)
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape)
                    .semantics { contentDescription = "Close $title" }
            ) {
                Icon(Icons.Outlined.Close, contentDescription = null)
            }
        }
        when (tool) {
            "pick" -> CheckpointSection(model, tagged = true)
            "navigate" -> NavigateSection(model, tagged = true)
            "location" -> LocationSection(model, tagged = true, onLocked = onLocked)
        }
    }
}

private fun mapTool(focus: String): String = when (focus) {
    "map-checkpoint-pick" -> "pick"
    "map-navigate" -> "navigate"
    "location-heartbeat" -> "location"
    else -> "none"
}

@Composable
private fun AidPager(model: MapViewModel) {
    val pages = model.aidPages
    // The page comes from the model, which outlives a fold, a resize or the replay switching
    // views. A saved pager page would come back stale after a recreation, and the report below
    // would take it for a swipe: the sheet would stop following the next aid station.
    val pagerState = remember(model) { PagerState(currentPage = model.aidIndex.coerceAtLeast(0)) { model.aidPages.size } }
    LaunchedEffect(model.aidIndex, pages.size) {
        if (pages.isEmpty()) return@LaunchedEffect
        val target = model.aidIndex.coerceIn(0, pages.lastIndex)
        if (pagerState.currentPage != target) pagerState.scrollToPage(target)
    }
    LaunchedEffect(pagerState.currentPage, pagerState.isScrollInProgress) {
        if (!pagerState.isScrollInProgress && pagerState.currentPage != model.aidIndex) {
            model.showAid(pagerState.currentPage)
        }
    }
    val colors = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    // A caret or a swipe: one page either way.
    val step: (Int) -> Unit = { delta ->
        val next = pagerState.currentPage + delta
        if (next in pages.indices) scope.launch { pagerState.animateScrollToPage(next) }
    }
    Box(Modifier.fillMaxWidth()) {
        HorizontalPager(state = pagerState, modifier = Modifier.fillMaxWidth()) { index ->
            AidPeek(pages[index])
        }
        // Gray carets say there's another aid that way; a tap steps to it.
        if (pagerState.currentPage > 0) {
            AidCaret(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Previous aid station", Modifier.align(Alignment.CenterStart)) { step(-1) }
        }
        if (pagerState.currentPage < pages.lastIndex) {
            AidCaret(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next aid station", Modifier.align(Alignment.CenterEnd)) { step(1) }
        }
    }
}

/** A small gray chevron at the pager's edge. */
@Composable
private fun AidCaret(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .size(width = 24.dp, height = 48.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.outline.copy(alpha = 0.8f))
    }
}

/**
 * One aid station in the pager. Everything on it belongs to that aid, so it all changes with a
 * swipe: its arrival (estimated, or the runner's real arrival once passed), the climb and distance
 * to it, and its planned stop.
 */
@Composable
private fun AidPeek(page: AidPage) {
    val colors = MaterialTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 28.dp)
            .semantics(mergeDescendants = true) { contentDescription = page.scheduleLine }
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(end = 8.dp)) {
                Kicker(aidKicker(page.kicker), color = if (page.passed) colors.onSurfaceVariant else colors.primary)
                Text(
                    page.title.lowercase().split(" ").joinToString(" ") { it.replaceFirstChar(Char::uppercase) },
                    modifier = Modifier.padding(top = 4.dp),
                    style = MaterialTheme.typography.titleLarge
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    CrewClock.short(page.arrivalAt) ?: page.clockLabel,
                    style = MetricStyle,
                    color = if (page.passed) colors.onSurface else colors.primary
                )
                Text(page.arrivalCaption, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                if (!page.passed && page.countdownLabel.isNotBlank()) {
                    Text(
                        page.countdownLabel,
                        modifier = Modifier
                            .padding(top = 4.dp)
                            .background(colors.primaryContainer, CircleShape)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
                        color = colors.onPrimaryContainer
                    )
                }
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 12.dp), color = colors.outlineVariant)
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (page.passed) {
                MetricColumn("Left", CrewClock.short(page.actualDepartureAt) ?: "—", Modifier.weight(1f), compact = true)
                VerticalDivider(Modifier.height(40.dp), color = colors.outlineVariant)
                MetricColumn("Stopped", page.actualStopLabel ?: "—", Modifier.weight(1f), compact = true)
            } else {
                MetricColumn("Distance to", page.distanceLabel.uppercase(), Modifier.weight(1f), compact = true)
                // A course with no elevation (a GPX without <ele>) shows no climb, not a 0.
                page.elevationLabel?.let { climb ->
                    VerticalDivider(Modifier.height(40.dp), color = colors.outlineVariant)
                    MetricColumn("Climb to", climb, Modifier.weight(1f), compact = true)
                }
            }
            VerticalDivider(Modifier.height(40.dp), color = colors.outlineVariant)
            MetricColumn("Planned stop", page.plannedStopLabel, Modifier.weight(1f), compact = true)
        }
    }
}

private fun aidKicker(kicker: String): String = when (kicker) {
    "NEXT" -> "Next aid station"
    "START" -> "Start"
    "FINISHED" -> "Finished"
    "PASSED" -> "Passed"
    "AHEAD" -> "Later aid station"
    "FINISH" -> "Finish"
    else -> kicker
}

@Composable
private fun CourseMapHost(
    points: List<MapCheckpoint>,
    line: List<CoursePoint>,
    track: List<CoursePoint>,
    onMapTap: (Double, Double) -> Unit,
    onStyleReady: () -> Unit,
    onStyleFailed: () -> Unit,
    onTilesUnavailable: () -> Unit,
    recenterRequest: Int,
    modifier: Modifier,
    framing: CourseFraming = CourseFraming.Screen,
    trackTimes: List<Long> = emptyList(),
    glide: (() -> RunnerGlideFrame?)? = null
) {
    val renderer = CourseMaps.renderer
    if (BuildConfig.MAP_LIBRE && renderer != null) {
        // A loader sits over the map until its style loads or fails.
        var settled by remember { mutableStateOf(false) }
        Box(modifier, contentAlignment = Alignment.Center) {
            renderer.Render(
                points,
                line,
                track,
                Modifier.fillMaxSize(),
                onMapTap,
                { settled = true; onStyleReady() },
                { settled = true; onStyleFailed() },
                { settled = true; onTilesUnavailable() },
                recenterRequest,
                framing,
                trackTimes,
                glide,
                onRendered = { _, _ -> }
            )
            if (!settled) {
                CairnLoader(
                    modifier = Modifier.size(64.dp).testTag("crewcue.map-loading"),
                    onLight = !LocalCrewExtras.current.dark
                )
            }
        }
    } else if (BuildConfig.MAP_LIBRE) {
        LaunchedEffect(Unit) { onStyleFailed() }
    }
}

@Composable
private fun CheckpointSection(model: MapViewModel, tagged: Boolean) {
    Column(sectionModifier(tagged, "crewcue.map-checkpoint-pick", "Pick checkpoint"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            PICK_SUCCESS,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        CrewTextField(model.pickTitle, model::updatePickTitle, "Checkpoint title")
        CrewTextField(model.pickLatitude, model::updatePickLatitude, "Latitude")
        CrewTextField(model.pickLongitude, model::updatePickLongitude, "Longitude")
        Text(model.pickMessage, modifier = Modifier.semantics { contentDescription = model.pickMessage })
        PillButton(
            "Save checkpoint",
            onClick = model::saveCheckpoint,
            modifier = Modifier.align(Alignment.End),
            prominent = true,
            busy = model.pickBusy
        )
    }
}

@Composable
private fun NavigateSection(model: MapViewModel, tagged: Boolean) {
    Column(sectionModifier(tagged, "crewcue.map-navigate", "Navigate"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(model.navigateMessage, modifier = Modifier.semantics { contentDescription = model.navigateMessage })
        model.checkpoints.forEach { checkpoint ->
            val selected = model.destinationId == checkpoint.id
            val label = if (selected) "Destination ${checkpoint.title}" else checkpoint.title
            if (selected) {
                PrimaryButton(label, onClick = { model.chooseDestination(checkpoint.id) })
            } else {
                SecondaryButton(label, onClick = { model.chooseDestination(checkpoint.id) })
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            PillButton(
                "Drive",
                onClick = { model.startRoute("drive") },
                enabled = !model.navigateBusy,
                busy = model.navigateMode == "drive",
                spoken = "Start navigation, drive"
            )
            PillButton(
                "Hike",
                onClick = { model.startRoute("hike") },
                prominent = true,
                enabled = !model.navigateBusy,
                busy = model.navigateMode == "hike",
                spoken = "Start navigation, hike"
            )
        }
    }
}

@Composable
private fun LocationSection(model: MapViewModel, tagged: Boolean, onLocked: (() -> Unit)? = null) {
    val context = LocalContext.current
    // Android 11+ asks for "all the time" separately, after fine location is granted.
    val background = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) model.backgroundDenied()
    }
    val fine = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            model.startTracking { startService(context, background) }
        } else {
            model.permissionDenied()
        }
    }
    Column(sectionModifier(tagged, "crewcue.location-heartbeat", "Location"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (!model.isAthlete) {
            Text(TRACKING_CREW, modifier = Modifier.semantics { contentDescription = TRACKING_CREW })
            return@Column
        }
        Text(model.locationMessage, modifier = Modifier.semantics { contentDescription = model.locationMessage })
        BatteryUnrestrictedPrompt()
        val minutes = intervalLabel(model.trackingIntervalSeconds)
        Text(
            "Your phone sends your position every $minutes, saving it while you have no service and sending it all when you're back in range. Change the interval in Settings.",
            style = MaterialTheme.typography.bodyMedium
        )
        if (model.trackingActive) {
            PillButton(
                "Stop tracking",
                onClick = { model.stopTracking { RaceTrackingService.stop(context) } },
                modifier = Modifier.align(Alignment.End),
                destructive = true
            )
        } else {
            PillButton(
                "Start tracking",
                modifier = Modifier.align(Alignment.End),
                prominent = true,
                onClick = {
                    // An unpaid race takes no pings: the paywall first.
                    if (onLocked != null) {
                        onLocked()
                        return@PillButton
                    }
                    val granted = ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.ACCESS_FINE_LOCATION
                    ) == PackageManager.PERMISSION_GRANTED
                    if (granted) {
                        model.startTracking { startService(context, background) }
                    } else {
                        fine.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                    }
                }
            )
        }
    }
}

/**
 * Phone makers' battery managers (Samsung, Xiaomi, OnePlus and others) can stop the tracking
 * service mid-race even though stock Android leaves a foreground service running. Until the app is
 * exempt from battery optimization ("Unrestricted"), ask the athlete to change it. Rechecked
 * every time the app comes back from Settings.
 */
@Composable
private fun BatteryUnrestrictedPrompt() {
    val context = LocalContext.current
    var unrestricted by remember { mutableStateOf(isBatteryUnrestricted(context)) }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    androidx.compose.runtime.DisposableEffect(lifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) unrestricted = isBatteryUnrestricted(context)
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    if (unrestricted) return
    Column(
        Modifier.testTag("crewcue.location-battery"),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            BATTERY_RESTRICTED,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.semantics { contentDescription = BATTERY_RESTRICTED }
        )
        SecondaryButton(BATTERY_SETTINGS, onClick = { openAppSettings(context) })
    }
}

private fun isBatteryUnrestricted(context: android.content.Context): Boolean {
    val power = context.getSystemService(android.os.PowerManager::class.java) ?: return true
    return power.isIgnoringBatteryOptimizations(context.packageName)
}

/** App info holds the battery setting on stock Android 12+ and on Samsung ("Battery" → "Unrestricted"). */
private fun openAppSettings(context: android.content.Context) {
    val intent = android.content.Intent(
        android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        android.net.Uri.fromParts("package", context.packageName, null)
    ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

private fun startService(
    context: android.content.Context,
    background: androidx.activity.result.ActivityResultLauncher<String>
) {
    RaceTrackingService.start(context)
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) !=
        PackageManager.PERMISSION_GRANTED
    ) {
        background.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }
}

internal fun intervalLabel(seconds: Int): String =
    if (seconds % 60 == 0) "${seconds / 60} min" else "$seconds s"

internal fun captureLocation(context: android.content.Context, model: MapViewModel) {
    requestLocationSample(
        context,
        onSample = { location ->
            val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
            model.onSample(location.latitude, location.longitude, accuracy, context.isOnline())
        },
        onMissing = model::locationMissing
    )
}

private fun mapBanner(model: MapViewModel): String? = when {
    model.courseStatus == MAP_OFFLINE || model.mapStatus == MAP_OFFLINE -> MAP_OFFLINE
    model.mapStatus == MAP_ERROR || model.courseStatus == MAP_ERROR -> MAP_ERROR
    model.courseStatus == MAP_EMPTY -> MAP_EMPTY
    else -> null
}

private fun sectionModifier(tagged: Boolean, tag: String, title: String): Modifier {
    val base = Modifier.fillMaxWidth().padding(top = 12.dp)
    return if (tagged) base.testTag(tag).semantics { contentDescription = title } else base
}
