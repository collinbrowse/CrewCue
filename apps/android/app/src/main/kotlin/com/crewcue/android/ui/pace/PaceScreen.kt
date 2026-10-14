package com.crewcue.android.ui.pace

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.map.MapViewModel
import com.crewcue.android.ui.map.RaceReadout
import com.crewcue.android.ui.map.TimelineRow
import com.crewcue.android.ui.theme.ChipStyle
import com.crewcue.android.ui.theme.CrewClock
import com.crewcue.android.ui.theme.CrewProgressBar
import com.crewcue.android.ui.theme.CrewTextField
import com.crewcue.android.ui.theme.IconDisc
import com.crewcue.android.ui.theme.Kicker
import com.crewcue.android.ui.theme.MetricColumn
import com.crewcue.android.ui.theme.MetricLargeStyle
import com.crewcue.android.ui.theme.MetricStyle
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.SecondaryButton
import com.crewcue.android.ui.theme.StatusChip
import com.crewcue.android.ui.theme.ToolSheet
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val TOOL_FOCUSES = setOf("check-in", "gpx-import", "crew-sheet-export", "course-settings", "outbox-status")

@Composable
fun PaceScreen(
    shell: ShellViewModel,
    roomId: String,
    modifier: Modifier = Modifier,
    focus: String = "schedule-sheet",
    race: MapViewModel? = null
) {
    val model: PaceViewModel = viewModel(
        key = "pace-$roomId",
        factory = PaceViewModelFactory(shell.container.raceDay, roomId)
    )
    LaunchedEffect(roomId) { model.load() }
    var showsTools by remember { mutableStateOf(false) }
    LaunchedEffect(focus, model.scheduleStops) {
        if (focus == "check-in") model.scheduleStops.firstOrNull()?.let { model.openCheckIn(it.id) }
        if (focus in TOOL_FOCUSES) showsTools = true
    }
    val readout = race?.readout ?: RaceReadout()
    val rows = race?.timeline.orEmpty()
    Box(modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(top = 12.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            PaceHeader(race?.raceName.orEmpty(), readout)
            EstimateCard(model)
            PaceTimeline(
                rows = rows,
                stops = model.scheduleStops,
                message = model.scheduleMessage,
                onCheckIn = { id ->
                    model.openCheckIn(id)
                    showsTools = true
                },
                onImport = { showsTools = true }
            )
        }
        FloatingActionButton(
            onClick = { showsTools = true },
            shape = CircleShape,
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
                .semantics { contentDescription = "Race tools" }
        ) {
            Icon(Icons.Outlined.EditCalendar, contentDescription = null)
        }
    }
    if (showsTools) {
        ToolSheet(title = "Race tools", onDismiss = { showsTools = false }) {
            PaceTools(model, focus)
        }
    }
}

@Composable
private fun PaceHeader(raceName: String, readout: RaceReadout) {
    Column(Modifier.semantics(mergeDescendants = true) {}) {
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Kicker("Course progress", color = MaterialTheme.colorScheme.primary)
                Text(
                    raceName.ifBlank { "Your race" },
                    style = MaterialTheme.typography.displaySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(readout.totalMilesLabel, style = MetricLargeStyle, color = MaterialTheme.colorScheme.primary)
                Kicker("Total miles")
            }
        }
        CrewProgressBar(readout.progressFraction, Modifier.padding(top = 12.dp))
    }
}

@Composable
private fun EstimateCard(model: PaceViewModel) {
    ProductCard(
        Modifier
            .testTag("crewcue.pace-estimate")
            .semantics { contentDescription = "Pace estimate" },
        padding = PaddingValues(20.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconDisc(Icons.AutoMirrored.Outlined.ShowChart)
            Column(Modifier.padding(start = 12.dp)) {
                Kicker("Pace estimate", color = MaterialTheme.colorScheme.primary)
                model.estimateMessage?.let { line ->
                    Text(line, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { contentDescription = line })
                }
                model.estimateDetail?.let { line ->
                    Text(line, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { contentDescription = line })
                }
            }
        }
        if (model.mayRecalculate) {
            PrimaryButton(
                "Recalculate",
                onClick = model::recalculate,
                modifier = Modifier.padding(top = 12.dp),
                enabled = !model.estimateBusy
            )
        }
    }
}

@Composable
private fun PaceTimeline(
    rows: List<TimelineRow>,
    stops: List<PaceStop>,
    message: String?,
    onCheckIn: (String) -> Unit,
    onImport: () -> Unit
) {
    Column(
        Modifier
            .testTag("crewcue.schedule-sheet")
            .semantics { contentDescription = "Schedule" },
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        message?.let { line ->
            Text(
                line,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.semantics { contentDescription = line }
            )
        }
        if (rows.isEmpty()) {
            ProductCard {
                Text("No aid stations yet", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Import a GPX course to build the schedule.",
                    modifier = Modifier.padding(top = 6.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                PrimaryButton("Import a course", onClick = onImport, modifier = Modifier.padding(top = 12.dp))
            }
        } else {
            rows.forEach { row ->
                val stop = stops.firstOrNull { it.id == row.checkpointId }
                if (row.state == "current") {
                    CurrentCheckpoint(row, stop) { onCheckIn(stop?.id ?: row.checkpointId) }
                } else {
                    CompactCheckpoint(row, stop)
                }
            }
        }
    }
}

@Composable
private fun CompactCheckpoint(row: TimelineRow, stop: PaceStop?) {
    val colors = MaterialTheme.colorScheme
    val done = row.state == "done"
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(if (done) 0.75f else 1f)
            .semantics(mergeDescendants = true) { contentDescription = stop?.line ?: row.title },
        shape = MaterialTheme.shapes.large,
        color = if (row.isFinish) colors.surfaceContainer else colors.surfaceContainerLowest,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.6f))
    ) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Marker(row)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(row.kicker, style = MaterialTheme.typography.labelSmall, color = if (row.isFinish) colors.primary else colors.onSurfaceVariant)
                Text(
                    row.title,
                    style = MaterialTheme.typography.titleLarge,
                    color = if (done) colors.onSurfaceVariant else colors.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    CrewClock.short(row.clockArrivalAt) ?: "—",
                    style = MetricStyle,
                    color = when {
                        row.isFinish -> colors.primary
                        done -> colors.onSurfaceVariant
                        else -> colors.onSurface
                    }
                )
                Text(
                    when {
                        row.isFinish -> "TARGET"
                        done -> stop?.let { "${it.arrival} · ${it.elapsed}" } ?: "PLANNED"
                        else -> "PROJECTED"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun CurrentCheckpoint(row: TimelineRow, stop: PaceStop?, onCheckIn: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = false) { contentDescription = stop?.line ?: row.title },
        shape = MaterialTheme.shapes.large,
        color = colors.surfaceContainerLowest,
        border = BorderStroke(1.5.dp, colors.primary.copy(alpha = 0.5f)),
        shadowElevation = 3.dp
    ) {
        Column(Modifier.padding(24.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Marker(row)
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(row.kicker, style = MaterialTheme.typography.labelSmall, color = colors.primary)
                    Text(row.title, style = MaterialTheme.typography.headlineSmall)
                }
                StatusChip("In progress", ChipStyle.Filled)
            }
            HorizontalDivider(Modifier.padding(vertical = 16.dp), color = colors.outlineVariant)
            Row {
                MetricColumn(
                    "Est. arrival",
                    CrewClock.short(row.clockArrivalAt) ?: "—",
                    Modifier.weight(1f),
                    alignment = Alignment.Start,
                    valueColor = colors.primary
                )
                MetricColumn(
                    "Cutoff",
                    CrewClock.short(row.cutoffAt) ?: "—",
                    Modifier.weight(1f),
                    valueColor = if (row.cutoffStatus == "warn" || row.cutoffStatus == "breach") colors.error else colors.onSurface
                )
                MetricColumn("Dist. to", row.distanceToLabel, Modifier.weight(1f), alignment = Alignment.End)
            }
            stop?.let {
                Text(
                    "${it.arrival} · ${it.elapsed} elapsed",
                    modifier = Modifier.padding(top = 12.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.onSurfaceVariant
                )
            }
            SecondaryButton("Check in", onClick = onCheckIn, modifier = Modifier.padding(top = 12.dp))
        }
    }
}

@Composable
private fun Marker(row: TimelineRow) {
    val colors = MaterialTheme.colorScheme
    Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
        when {
            row.isFinish -> Icon(Icons.Outlined.Flag, contentDescription = null, tint = colors.primary)
            row.state == "done" -> Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = colors.primary.copy(alpha = 0.7f))
            else -> Box(
                Modifier
                    .size(12.dp)
                    .background(if (row.state == "current") colors.primary else Color.Transparent, CircleShape)
                    .border(2.dp, colors.primary.copy(alpha = 0.6f), CircleShape)
            )
        }
    }
}

/** Secondary tools behind the FAB: check-in, route file, crew sheet, course settings, outbox. */
@Composable
private fun PaceTools(model: PaceViewModel, focus: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val payload = withContext(Dispatchers.IO) { readGpx(context, uri) }
            if (payload == null) model.gpxUnreadable() else model.importGpx(payload.first, payload.second)
        }
    }
    if (model.checkInOpen || focus == "check-in") {
        ProductCard(Modifier.testTag("crewcue.check-in")) {
            Text("Check in", style = MaterialTheme.typography.titleLarge)
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CrewTextField(model.checkpointId, model::updateCheckpoint, "Checkpoint")
                CrewTextField(model.arrival, model::updateArrival, "Arrival")
                CrewTextField(model.departure, model::updateDeparture, "Departure")
                model.checkInMessage?.let { line ->
                    Text(line, modifier = Modifier.semantics { contentDescription = line })
                }
                PrimaryButton("Check in", onClick = model::submitCheckIn, enabled = !model.checkInBusy)
            }
        }
    }
    ProductCard(Modifier.testTag("crewcue.gpx-import")) {
        Text("Route file", style = MaterialTheme.typography.titleLarge)
        Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                model.gpxMessage,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { contentDescription = model.gpxMessage }
            )
            CrewTextField(model.gpxText, model::updateGpxText, "GPX", singleLine = false, minLines = 2)
            SecondaryButton(
                "Choose file",
                onClick = { picker.launch(arrayOf("*/*")) },
                enabled = !model.gpxBusy,
                spoken = "Choose route file"
            )
            PrimaryButton("Import", onClick = model::importPastedGpx, enabled = !model.gpxBusy, spoken = "Import route")
        }
    }
    ProductCard(Modifier.testTag("crewcue.crew-sheet-export")) {
        Text("Crew sheet", style = MaterialTheme.typography.titleLarge)
        model.exportMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.exportText?.let { line ->
            Text(
                line,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceContainer, MaterialTheme.shapes.small)
                    .padding(12.dp)
                    .semantics { contentDescription = "Crew sheet" },
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace)
            )
        }
        PrimaryButton(
            "Share",
            onClick = { model.exportText?.let { shareCrewSheet(context, it) } },
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.exportText.isNullOrBlank(),
            spoken = "Share crew sheet"
        )
    }
    ProductCard(Modifier.testTag("crewcue.course-settings")) {
        Text("Course settings", style = MaterialTheme.typography.titleLarge)
        Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            model.courseMessage?.let { line ->
                Text(line, modifier = Modifier.semantics { contentDescription = line })
            }
            CrewTextField(model.cutoffNote, model::updateCutoff, "Cutoff", singleLine = false)
            CrewTextField(
                model.stoppageText,
                model::updateStoppage,
                "Stoppage seconds",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
            )
            PrimaryButton("Save draft", onClick = model::saveCourse, enabled = !model.courseBusy, spoken = "Save course settings")
        }
    }
    ProductCard(Modifier.testTag("crewcue.outbox")) {
        Text("Outbox", style = MaterialTheme.typography.titleLarge)
        model.outboxMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.outboxLines.forEach { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
    }
}

private fun readGpx(context: Context, uri: Uri): Pair<String, String>? {
    return try {
        val name = displayName(context, uri)
        val text = context.contentResolver.openInputStream(uri)?.use { stream ->
            stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } ?: return null
        if (text.length > 4_000_000) return null
        name to text
    } catch (_: Exception) {
        null
    }
}

private fun displayName(context: Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val name = cursor.getString(0)
            if (!name.isNullOrBlank()) return name
        }
    }
    return uri.lastPathSegment ?: "route.gpx"
}

private fun shareCrewSheet(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    runCatching { context.startActivity(Intent.createChooser(send, "Share crew sheet")) }
}
