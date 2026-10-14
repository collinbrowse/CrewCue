package com.crewcue.android.ui.map

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.BuildConfig
import com.crewcue.android.ui.ShellViewModel

@Composable
fun MapScreen(
    shell: ShellViewModel,
    roomId: String,
    focus: String,
    modifier: Modifier = Modifier
) {
    val role = shell.session?.role.orEmpty()
    val model: MapViewModel = viewModel(
        key = "map-$roomId-$role",
        factory = MapViewModelFactory(shell.container.raceDay, roomId, role)
    )
    LaunchedEffect(roomId) { model.load() }
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
                modifier = Modifier.fillMaxSize()
            )
            val banner = mapBanner(model)
            if (banner != null) {
                Text(
                    banner,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .semantics { contentDescription = banner }
                )
            }
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .then(if (showMap) Modifier.heightIn(max = 420.dp) else Modifier.fillMaxHeight())
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            if (showMap && model.aidPages.isNotEmpty()) {
                AidPager(model)
                val live = model.aidLiveNext
                if (!model.aidFollow && live != null && live != model.aidIndex) {
                    Button(
                        onClick = model::jumpToNextAid,
                        modifier = Modifier.padding(top = 8.dp).fillMaxWidth().semantics {
                            contentDescription = "Next station"
                        }
                    ) {
                        Text("Next station")
                    }
                }
            }
            if (showMap) {
                model.checkpoints.forEach { checkpoint ->
                    Text(
                        checkpoint.title,
                        modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = checkpoint.title }
                    )
                }
                if (!BuildConfig.MAP_LIBRE && BuildConfig.MAP_LIBRE_ERROR.isNotBlank()) {
                    Text(
                        BuildConfig.MAP_LIBRE_ERROR,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
            if (focus == "map-track" || focus == "map-checkpoint-pick") {
                CheckpointSection(model, tagged = focus == "map-track")
            }
            if (focus == "map-track" || focus == "map-navigate") {
                NavigateSection(model, tagged = focus == "map-track")
            }
            if (focus == "map-track" || focus == "location-heartbeat") {
                LocationSection(model, tagged = focus == "map-track")
            }
        }
    }
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
    HorizontalPager(state = pagerState, modifier = Modifier.fillMaxWidth().height(148.dp)) { index ->
        val page = pages[index]
        Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp).semantics { contentDescription = page.scheduleLine }) {
            Row {
                Column(Modifier.weight(1f)) {
                    Text(page.kicker, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(page.title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleLarge)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(page.clockLabel, fontWeight = FontWeight.ExtraBold)
                    Text("EST. ARRIVAL", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(page.remainLabel, fontWeight = FontWeight.ExtraBold)
                }
            }
            Spacer(Modifier.height(8.dp))
            Row {
                Text(page.distanceLabel, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Text(page.stoppageLabel, fontWeight = FontWeight.SemiBold)
                page.delayLabel?.let { delay ->
                    Text(delay, modifier = Modifier.padding(start = 8.dp), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun CourseMapHost(
    points: List<MapCheckpoint>,
    line: List<CoursePoint>,
    onMapTap: (Double, Double) -> Unit,
    onStyleReady: () -> Unit,
    onStyleFailed: () -> Unit,
    onTilesUnavailable: () -> Unit,
    modifier: Modifier
) {
    val renderer = CourseMaps.renderer
    if (BuildConfig.MAP_LIBRE && renderer != null) {
        renderer.Render(points, line, modifier, onMapTap, onStyleReady, onStyleFailed, onTilesUnavailable)
    } else if (BuildConfig.MAP_LIBRE) {
        LaunchedEffect(Unit) { onStyleFailed() }
    }
}

@Composable
private fun CheckpointSection(model: MapViewModel, tagged: Boolean) {
    Column(sectionModifier(tagged, "crewcue.map-checkpoint-pick", "Pick checkpoint")) {
        Text("Pick checkpoint")
        Text(
            model.pickMessage,
            modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.pickMessage }
        )
        OutlinedTextField(
            value = model.pickTitle,
            onValueChange = model::updatePickTitle,
            label = { Text("Title") },
            singleLine = true,
            modifier = Modifier.padding(top = 8.dp).fillMaxWidth().semantics { contentDescription = "Checkpoint title" }
        )
        OutlinedTextField(
            value = model.pickLatitude,
            onValueChange = model::updatePickLatitude,
            label = { Text("Latitude") },
            singleLine = true,
            modifier = Modifier.padding(top = 8.dp).fillMaxWidth().semantics { contentDescription = "Latitude" }
        )
        OutlinedTextField(
            value = model.pickLongitude,
            onValueChange = model::updatePickLongitude,
            label = { Text("Longitude") },
            singleLine = true,
            modifier = Modifier.padding(top = 8.dp).fillMaxWidth().semantics { contentDescription = "Longitude" }
        )
        Button(
            onClick = model::saveCheckpoint,
            enabled = !model.pickBusy,
            modifier = Modifier.padding(top = 12.dp).fillMaxWidth().semantics { contentDescription = "Save checkpoint" }
        ) {
            Text("Save checkpoint")
        }
    }
}

@Composable
private fun NavigateSection(model: MapViewModel, tagged: Boolean) {
    Column(sectionModifier(tagged, "crewcue.map-navigate", "Navigate")) {
        Text("Navigate")
        Text(
            model.navigateMessage,
            modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.navigateMessage }
        )
        model.checkpoints.forEach { checkpoint ->
            val selected = model.destinationId == checkpoint.id
            Button(
                onClick = { model.chooseDestination(checkpoint.id) },
                modifier = Modifier.padding(top = 8.dp).fillMaxWidth().semantics {
                    contentDescription = if (selected) "Destination ${checkpoint.title}" else checkpoint.title
                }
            ) {
                Text(if (selected) "Destination ${checkpoint.title}" else checkpoint.title)
            }
        }
        Button(
            onClick = { model.startRoute("hike") },
            enabled = !model.navigateBusy,
            modifier = Modifier.padding(top = 12.dp).fillMaxWidth().semantics { contentDescription = "Hike" }
        ) {
            Text("Hike")
        }
        Button(
            onClick = { model.startRoute("drive") },
            enabled = !model.navigateBusy,
            modifier = Modifier.padding(top = 8.dp).fillMaxWidth().semantics { contentDescription = "Drive" }
        ) {
            Text("Drive")
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
    Column(sectionModifier(tagged, "crewcue.location-heartbeat", "Location")) {
        Text("Location")
        Text(
            model.locationMessage,
            modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.locationMessage }
        )
        Button(
            onClick = {
                val granted = ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) captureLocation(context, model) else launcher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            },
            modifier = Modifier.padding(top = 12.dp).fillMaxWidth().semantics { contentDescription = "Send location" }
        ) {
            Text("Send location")
        }
    }
}

private fun captureLocation(context: android.content.Context, model: MapViewModel) {
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
    val base = Modifier.fillMaxWidth().padding(top = 16.dp)
    return if (tagged) base.testTag(tag).semantics { contentDescription = title } else base
}
