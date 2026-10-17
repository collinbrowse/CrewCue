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
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
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
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.brand.CairnLoader
import com.crewcue.android.ui.theme.ChipStyle
import com.crewcue.android.ui.theme.CircleIconButton
import com.crewcue.android.ui.theme.CrewClock
import com.crewcue.android.ui.theme.CrewProgressBar
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
    bottomInset: Dp = 16.dp
) {
    val role = shell.session?.role.orEmpty()
    val model: MapViewModel = viewModel(
        key = "map-$roomId-$role",
        factory = MapViewModelFactory(shell.container.raceDay, roomId, role)
    )
    LaunchedEffect(roomId) { model.load() }
    var tool by remember(focus) { mutableStateOf(mapTool(focus)) }
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
                onMapTap = model::onMapTap,
                onStyleReady = model::onStyleReady,
                onStyleFailed = model::onStyleFailed,
                onTilesUnavailable = model::onTilesUnavailable,
                recenterRequest = model.recenterRequest,
                modifier = Modifier.fillMaxSize()
            )
            MapOverlay(model, onTool = { tool = it }, modifier = Modifier.align(Alignment.TopStart))
        }
        MapSheet(
            model = model,
            tool = tool,
            onCloseTool = { tool = "none" },
            fillHeight = !showMap,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 8.dp)
                .padding(bottom = bottomInset)
                .navigationBarsPadding()
        )
    }
}

/** Status chips and the round map controls under the shell top bar. */
@Composable
private fun MapOverlay(model: MapViewModel, onTool: (String) -> Unit, modifier: Modifier = Modifier) {
    var menu by remember { mutableStateOf(false) }
    Row(
        modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(top = 76.dp, start = 16.dp, end = 16.dp),
        verticalAlignment = Alignment.Top
    ) {
        val readout = model.readout
        if (readout.statusLabel.isNotBlank()) {
            StatusChip(readout.statusLabel, if (readout.status == "behind") ChipStyle.Soft else ChipStyle.Filled)
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            StatusChip(readout.pingLabel, ChipStyle.Surface, dot = readout.pingState == "live")
            CircleIconButton(Icons.Outlined.MyLocation, "Fit course", onClick = model::recenter)
            Box {
                CircleIconButton(Icons.Outlined.Layers, "Map tools", onClick = { menu = true })
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    listOf(
                        "none" to "Aid stations",
                        "pick" to "Place checkpoint",
                        "navigate" to "Navigate",
                        "location" to "Share location"
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
                ToolContent(model, tool, onCloseTool)
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
        val page = model.aidPages.getOrNull(model.aidIndex)
        Column(Modifier.padding(horizontal = 24.dp).padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(32.dp))
                    .padding(24.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Kicker("Course progress", modifier = Modifier.weight(1f))
                    Text(model.readout.progressLabel, style = MaterialTheme.typography.titleLarge)
                }
                CrewProgressBar(model.readout.progressFraction, Modifier.padding(top = 12.dp))
            }
            if (page != null) {
                Row {
                    MetricColumn("Planned stop", page.stoppageDurationLabel, Modifier.weight(1f))
                    MetricColumn("Elapsed", page.elapsedLabel, Modifier.weight(1f))
                    MetricColumn("Delay", page.delayLabel ?: "—", Modifier.weight(1f))
                }
            }
            val live = model.aidLiveNext
            if (!model.aidFollow && live != null && live != model.aidIndex) {
                SecondaryButton("Next station", onClick = model::jumpToNextAid)
            }
        }
    }
}

@Composable
private fun ToolContent(model: MapViewModel, tool: String, onClose: () -> Unit) {
    val title = when (tool) {
        "pick" -> "Place checkpoint"
        "navigate" -> "Navigate"
        else -> "Share location"
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
            "location" -> LocationSection(model, tagged = true)
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
    val pagerState = rememberPagerState(initialPage = model.aidIndex.coerceAtLeast(0)) { pages.size }
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
    HorizontalPager(state = pagerState, modifier = Modifier.fillMaxWidth()) { index ->
        val page = pages[index]
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .semantics(mergeDescendants = true) { contentDescription = page.scheduleLine }
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Kicker(aidKicker(page.kicker), color = colors.primary)
                    Text(
                        page.title.lowercase().split(" ").joinToString(" ") { it.replaceFirstChar(Char::uppercase) },
                        modifier = Modifier.padding(top = 6.dp),
                        style = MaterialTheme.typography.headlineSmall,
                        maxLines = 2
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        CrewClock.short(page.arrivalAt) ?: page.clockLabel,
                        style = MetricLargeStyle,
                        color = colors.primary
                    )
                    Text("EST. ARRIVAL", style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                    Text(
                        page.remainLabel,
                        modifier = Modifier
                            .padding(top = 6.dp)
                            .background(colors.primaryContainer, CircleShape)
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.onPrimaryContainer
                    )
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 16.dp), color = colors.outlineVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                MetricColumn("Distance\nremaining", page.distanceLabel.uppercase(), Modifier.weight(1f))
                VerticalDivider(Modifier.height(52.dp), color = colors.outlineVariant)
                MetricColumn("Elevation\nremaining", page.elevationLabel ?: "—", Modifier.weight(1f))
                VerticalDivider(Modifier.height(52.dp), color = colors.outlineVariant)
                MetricColumn("Avg\npace", model.readout.averagePaceLabel, Modifier.weight(1f))
            }
        }
    }
}

private fun aidKicker(kicker: String): String = when (kicker) {
    "NEXT" -> "Next aid station"
    "START" -> "Start"
    "FINISHED" -> "Finished"
    else -> kicker
}

@Composable
private fun CourseMapHost(
    points: List<MapCheckpoint>,
    line: List<CoursePoint>,
    onMapTap: (Double, Double) -> Unit,
    onStyleReady: () -> Unit,
    onStyleFailed: () -> Unit,
    onTilesUnavailable: () -> Unit,
    recenterRequest: Int,
    modifier: Modifier
) {
    val renderer = CourseMaps.renderer
    if (BuildConfig.MAP_LIBRE && renderer != null) {
        // A loader sits over the map until its style loads or fails.
        var settled by remember { mutableStateOf(false) }
        Box(modifier, contentAlignment = Alignment.Center) {
            renderer.Render(
                points,
                line,
                Modifier.fillMaxSize(),
                onMapTap,
                { settled = true; onStyleReady() },
                { settled = true; onStyleFailed() },
                { settled = true; onTilesUnavailable() },
                recenterRequest
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
        PrimaryButton("Save checkpoint", onClick = model::saveCheckpoint, busy = model.pickBusy)
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
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(
                "Hike",
                onClick = { model.startRoute("hike") },
                enabled = !model.navigateBusy,
                busy = model.navigateMode == "hike",
                modifier = Modifier.weight(1f)
            )
            SecondaryButton(
                "Drive",
                onClick = { model.startRoute("drive") },
                enabled = !model.navigateBusy,
                busy = model.navigateMode == "drive",
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun LocationSection(model: MapViewModel, tagged: Boolean) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) captureLocation(context, model) else model.permissionDenied()
    }
    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) captureLocation(context, model) else launcher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    Column(sectionModifier(tagged, "crewcue.location-heartbeat", "Location"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(model.locationMessage, modifier = Modifier.semantics { contentDescription = model.locationMessage })
        PrimaryButton(
            "Send location",
            onClick = {
                val granted = ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) captureLocation(context, model) else launcher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        )
    }
}

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
