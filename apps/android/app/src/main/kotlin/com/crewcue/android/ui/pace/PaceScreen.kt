package com.crewcue.android.ui.pace

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
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
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.foundation.clickable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import com.crewcue.android.ui.theme.PillButton
import com.crewcue.android.ui.theme.RowDivider
import com.crewcue.android.ui.theme.SettingRow
import com.crewcue.android.ui.theme.SettingsGroup
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.AcUnit
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import com.crewcue.android.ui.onboarding.TeaserRow
import com.crewcue.android.ui.theme.ChipStyle
import com.crewcue.android.ui.theme.CrewClock
import com.crewcue.android.ui.theme.CrewProgressBar
import com.crewcue.android.ui.theme.CrewTextField
import com.crewcue.android.ui.theme.GhostButton
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

private val TOOL_FOCUSES = setOf(
    "check-in", "gpx-import", "crew-sheet-export", "course-settings", "outbox-status", "pace-estimate", "cold-start"
)

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
    PaceContent(model, roomId, modifier, focus, race)
}

/**
 * What a [PaceViewModel.readOnly] Pace (the onboarding replay) shows for the aid stations an unpaid
 * race withholds: each row [row] (client-core's "Locked"), under [explanation].
 */
data class LockedRowText(val row: String, val explanation: String)

/**
 * Pace on a given [model]: the shell's race, or (a [PaceViewModel.readOnly] model) the onboarding
 * replay's, which shows the progress, the estimate and the timeline only, every withheld aid
 * station [locked], and no race tools, check-in or stop edits. Progress and the live finish come
 * from [race], the runner's pings.
 */
@Composable
fun PaceContent(
    model: PaceViewModel,
    roomId: String,
    modifier: Modifier = Modifier,
    focus: String = "schedule-sheet",
    race: MapViewModel? = null,
    locked: LockedRowText? = null
) {
    LaunchedEffect(roomId) { model.load() }
    val readOnly = model.readOnly
    var showsTools by rememberSaveable { mutableStateOf(false) }
    val liveRows = race?.timeline.orEmpty()
    val passedIds = liveRows.filter { it.state == "done" }.map { it.checkpointId }.toSet()
    LaunchedEffect(focus, model.scheduleStops) {
        if (readOnly) return@LaunchedEffect
        if (focus == "check-in") model.scheduleStops.firstOrNull()?.let { model.openCheckIn(it.id) }
        if (focus in TOOL_FOCUSES) showsTools = true
    }
    LaunchedEffect(passedIds) { model.runnerPassed(passedIds) }
    LaunchedEffect(focus, model.mayEditStops) {
        if (focus == "pace-stop-edit" && model.mayEditStops && !model.stopEditing) model.beginStopEdit(passedIds)
    }
    val readout = race?.readout ?: RaceReadout()
    // While editing planned stops the timeline renders from the draft, so arrivals preview the change.
    val rows = model.stopTimeline ?: liveRows
    val titles = race?.checkpoints?.associate { it.id to it.title }.orEmpty()
    Box(modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(top = 12.dp, bottom = if (readOnly) 16.dp else 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            model.raceName = race?.raceName.orEmpty()
            val named = titles.entries.mapNotNull { entry -> entry.value?.let { entry.key to it.toString() } }.toMap()
            LaunchedEffect(named) { model.noteCourseTitles(named) }
            PaceHeader(race?.raceName.orEmpty(), readout)
            if (readOnly) {
                // The replay has no race tools, so its estimate stays on the page.
                EstimateCard(model)
            } else if (model.mayEditStops || model.stopMessage != null) {
                StopEditBar(model, onBegin = { model.beginStopEdit(passedIds) })
            }
            PaceTimeline(
                rows = rows,
                liveStale = readout.liveEtaStale,
                stops = model.scheduleStops,
                message = model.scheduleMessage,
                editing = model.stopEditing,
                editRows = if (model.stopEditing) model.stopRows else emptyList(),
                onStopMinutes = model::updateStopMinutes,
                onStepStop = model::stepStop,
                onCheckIn = { id ->
                    model.openCheckIn(id)
                    showsTools = true
                },
                onImport = { showsTools = true },
                showsActions = !readOnly,
                locked = locked?.let { LockedRows(model.lockedIds, titles, it) }
            )
        }
        // Hidden while editing stops: it would cover the last stepper.
        if (!readOnly && !model.stopEditing) {
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
                Icon(Icons.Outlined.Build, contentDescription = null)
            }
        }
    }
    if (showsTools && !readOnly) {
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
                Text(raceName.ifBlank { "Your race" }, style = MaterialTheme.typography.headlineSmall)
            }
            Column(Modifier.padding(start = 8.dp), horizontalAlignment = Alignment.End) {
                Text(readout.totalMilesLabel, style = MetricStyle, color = MaterialTheme.colorScheme.primary)
                Kicker("Total miles")
            }
        }
        CrewProgressBar(readout.progressFraction, Modifier.padding(top = 12.dp))
        CrewClock.short(readout.finishEtaAt)?.let { finish ->
            val window = windowText(readout.finishWindowStartAt, readout.finishWindowEndAt)
            val text = listOfNotNull(finish, window, "old ping".takeIf { readout.liveEtaStale }).joinToString(" · ")
            Row(
                Modifier
                    .padding(top = 8.dp)
                    .testTag("crewcue.live-eta")
                    .semantics(mergeDescendants = true) { contentDescription = "Finish ETA $text" },
                verticalAlignment = Alignment.CenterVertically
            ) {
                Kicker("Finish ETA")
                Text(text, modifier = Modifier.padding(start = 8.dp), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

/** "13:10–16:05" when the server sent a window; null otherwise. */
private fun windowText(start: String?, end: String?): String? {
    val from = CrewClock.short(start) ?: return null
    val to = CrewClock.short(end) ?: return null
    return "$from–$to"
}

/** Under a live arrival: the window, the plan, and an old-ping flag. */
/**
 * A collapsed row, spoken: its title, the planned arrival and race time in words, then the live
 * arrival when there is one.
 */
private fun compactSpoken(row: TimelineRow, stop: PaceStop?): String = listOfNotNull(
    stop?.title ?: row.title,
    stop?.plannedArrivalSpoken?.takeIf { it.isNotBlank() },
    CrewClock.short(row.liveArrivalAt)?.let { "Live arrival $it" }
).joinToString(". ")

private fun liveCaption(row: TimelineRow, stale: Boolean): String = listOfNotNull(
    windowText(row.arrivalWindowStartAt, row.arrivalWindowEndAt),
    CrewClock.short(row.clockArrivalAt)?.let { "PLAN $it" } ?: "LIVE",
    "OLD PING".takeIf { stale }
).joinToString(" · ")

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
                    val tag = if (model.showsColdStart) Modifier.testTag("crewcue.cold-start") else Modifier
                    Text(line, style = MaterialTheme.typography.bodyMedium, modifier = tag.semantics { contentDescription = line })
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
                busy = model.estimateBusy
            )
        }
    }
}

/** Race tools → Pace: the estimate as the row's hint, with a small Recalculate beside it. */
@Composable
private fun PaceEstimateRow(model: PaceViewModel) {
    val hint = listOfNotNull(model.estimateMessage, model.estimateDetail).joinToString(" ")
    SettingRow(
        if (model.showsColdStart) Icons.Outlined.AcUnit else Icons.AutoMirrored.Outlined.ShowChart,
        "Pace estimate",
        modifier = Modifier
            .testTag("crewcue.pace-estimate")
            .then(if (model.showsColdStart) Modifier.testTag("crewcue.cold-start") else Modifier)
            .semantics { contentDescription = "Pace estimate" },
        hint = hint.ifBlank { null },
        trailing = if (model.mayRecalculate) {
            {
                PillButton(
                    "Recalculate",
                    onClick = model::recalculate,
                    prominent = true,
                    busy = model.estimateBusy,
                    icon = Icons.Outlined.Refresh
                )
            }
        } else {
            null
        }
    )
}

@Composable
private fun PaceTimeline(
    rows: List<TimelineRow>,
    liveStale: Boolean = false,
    stops: List<PaceStop>,
    message: String?,
    /** Planned stops are being edited: the cards turn into editors inside a dashed panel. */
    editing: Boolean = false,
    editRows: List<StopEditRow> = emptyList(),
    onStopMinutes: (String, String) -> Unit = { _, _ -> },
    onStepStop: (String, Int) -> Unit = { _, _ -> },
    onCheckIn: (String) -> Unit,
    onImport: () -> Unit,
    /** Off in the onboarding replay: no Check in and no Import a course. */
    showsActions: Boolean = true,
    /** Set in the onboarding replay: the withheld aid stations show as locked rows. */
    locked: LockedRows? = null
) {
    val colors = MaterialTheme.colorScheme
    // Edit mode steps the cards back inside a tinted, dashed panel, so it reads as a different mode.
    // The panel keeps to the page's own margins: nothing widens or reaches the screen edge.
    val panel = if (editing) {
        Modifier
            .background(colors.primaryContainer.copy(alpha = 0.22f), RoundedCornerShape(EDIT_PANEL_RADIUS))
            .dashedBorder(colors.primary.copy(alpha = 0.5f), EDIT_PANEL_RADIUS)
            .padding(horizontal = 8.dp, vertical = 12.dp)
    } else {
        Modifier
    }
    Column(
        Modifier
            .testTag("crewcue.schedule-sheet")
            .semantics { contentDescription = "Schedule" }
            .animateContentSize()
            .then(panel),
        verticalArrangement = Arrangement.spacedBy(if (editing) 8.dp else 12.dp)
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
                if (showsActions) {
                    PillButton("Import a course", onClick = onImport, modifier = Modifier.padding(top = 12.dp), prominent = true)
                }
            }
        } else {
            val shown = locked?.takeIf { it.ids.isNotEmpty() }?.let { TeaserRow.build(rows, it.ids, it.titles) }
                ?: rows.map { TeaserRow.Open(it) }
            if (locked != null && shown.any { it is TeaserRow.Locked } && locked.text.explanation.isNotBlank()) {
                Text(
                    locked.text.explanation,
                    modifier = Modifier.testTag("crewcue.pace.locked-note"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            shown.forEach { entry ->
                val row = when (entry) {
                    is TeaserRow.Open -> entry.row
                    is TeaserRow.Locked -> {
                        LockedCheckpoint(entry, locked?.text?.row.orEmpty())
                        return@forEach
                    }
                }
                val edit = editRows.firstOrNull { it.checkpointId == row.checkpointId }
                // While editing, the dwell rail shows the draft stop, like the arrivals above it.
                val stop = stops.firstOrNull { it.id == row.checkpointId }
                    ?.let { live -> edit?.let { live.copy(stopLabel = it.stopLabel) } ?: live }
                if (editing) {
                    StopEditCard(
                        row,
                        stop,
                        edit,
                        onMinutes = { onStopMinutes(row.checkpointId, it) },
                        onStep = { onStepStop(row.checkpointId, it) }
                    )
                } else if (row.state == "current") {
                    CurrentCheckpoint(row, stop, liveStale, onCheckIn = if (showsActions) ({ onCheckIn(stop?.id ?: row.checkpointId) }) else null)
                } else {
                    CompactCheckpoint(row, stop, liveStale)
                }
            }
        }
    }
}

@Composable
private fun CompactCheckpoint(row: TimelineRow, stop: PaceStop?, liveStale: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    val done = row.state == "done"
    val liveClock = CrewClock.short(row.liveArrivalAt)
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(if (done) 0.75f else 1f)
            .semantics(mergeDescendants = true) { contentDescription = compactSpoken(row, stop) },
        shape = MaterialTheme.shapes.large,
        color = if (row.isFinish) colors.surfaceContainer else colors.surfaceContainerLowest,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.6f))
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Marker(row)
            Column(Modifier.weight(1f).padding(start = 12.dp, end = 8.dp)) {
                Text(row.kicker, style = MaterialTheme.typography.labelSmall, color = if (row.isFinish) colors.primary else colors.onSurfaceVariant)
                // Titles wrap; they never shrink or truncate.
                Text(
                    row.title,
                    style = CardTitleStyle,
                    color = if (done) colors.onSurfaceVariant else colors.onSurface
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    liveClock?.let { "ETA $it" } ?: CrewClock.short(row.clockArrivalAt) ?: "—",
                    style = CardClockStyle,
                    color = when {
                        row.isFinish -> colors.primary
                        done -> colors.onSurfaceVariant
                        else -> colors.onSurface
                    }
                )
                Text(
                    when {
                        liveClock != null -> liveCaption(row, liveStale)
                        row.isFinish -> "TARGET"
                        // The clock above is the planned arrival; under it, the planned race time at
                        // that aid ("RACE 1:10:00"), and on stops still ahead the planned stop.
                        stop != null -> listOfNotNull(
                            stop.raceTime.takeIf { it.isNotBlank() },
                            stop.stopLabel.takeIf { !done && it.isNotBlank() && it != "NO STOP" }
                        ).joinToString(" · ")
                        done -> "PLANNED"
                        else -> "PROJECTED"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceVariant,
                    textAlign = TextAlign.End
                )
            }
        }
    }
}

@Composable
private fun CurrentCheckpoint(row: TimelineRow, stop: PaceStop?, liveStale: Boolean = false, onCheckIn: (() -> Unit)?) {
    val colors = MaterialTheme.colorScheme
    val liveClock = CrewClock.short(row.liveArrivalAt)
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = false) { contentDescription = stop?.line ?: row.title },
        shape = MaterialTheme.shapes.large,
        color = colors.surfaceContainerLowest,
        border = BorderStroke(1.5.dp, colors.primary.copy(alpha = 0.5f)),
        shadowElevation = 3.dp
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Marker(row)
                Column(Modifier.weight(1f).padding(start = 12.dp, end = 8.dp)) {
                    Text(row.kicker, style = MaterialTheme.typography.labelSmall, color = colors.primary)
                    Text(row.title, style = MaterialTheme.typography.titleLarge)
                }
                StatusChip("In progress", ChipStyle.Filled)
            }
            HorizontalDivider(Modifier.padding(vertical = 12.dp), color = colors.outlineVariant)
            Row {
                // The caption below already says OLD PING, so the label is just "Live ETA".
                MetricColumn(
                    if (liveClock == null) "Est. arrival" else "Live ETA",
                    liveClock ?: CrewClock.short(row.clockArrivalAt) ?: "—",
                    Modifier.weight(1f),
                    alignment = Alignment.Start,
                    valueColor = colors.primary,
                    compact = true
                )
                MetricColumn(
                    "Cutoff",
                    CrewClock.short(row.cutoffAt) ?: "—",
                    Modifier.weight(1f),
                    valueColor = if (row.cutoffStatus == "warn" || row.cutoffStatus == "breach") colors.error else colors.onSurface,
                    compact = true
                )
                MetricColumn("Dist. to", row.distanceToLabel, Modifier.weight(1f), alignment = Alignment.End, compact = true)
            }
            if (liveClock != null) {
                Text(
                    liveCaption(row, liveStale),
                    modifier = Modifier.padding(top = 10.dp).testTag("crewcue.live-eta.current"),
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.onSurfaceVariant
                )
            }
            stop?.let {
                Text(
                    listOf("${it.arrival} · ${it.elapsed} elapsed", it.stopLabel.lowercase()).filter(String::isNotBlank).joinToString(" · "),
                    modifier = Modifier.padding(top = 12.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.onSurfaceVariant
                )
            }
            if (onCheckIn != null) {
                PillButton("Check in", onClick = onCheckIn, modifier = Modifier.padding(top = 12.dp), icon = Icons.Outlined.CheckCircle)
            }
        }
    }
}

/** The withheld aid stations ([ids], in course order, `sheet.locked`) with their course [titles]. */
class LockedRows(val ids: List<String>, val titles: Map<String, String>, val text: LockedRowText)

/** An aid station an unpaid race withholds: its name and "Locked", no time. */
@Composable
private fun LockedCheckpoint(row: TeaserRow.Locked, label: String) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("crewcue.pace.locked.${row.checkpointId}")
            .semantics(mergeDescendants = true) { contentDescription = "${row.title}, $label" },
        shape = MaterialTheme.shapes.large,
        color = colors.surfaceContainerLowest,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.6f))
    ) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = colors.onSurfaceVariant)
            }
            Text(
                row.title,
                modifier = Modifier.weight(1f).padding(start = 12.dp),
                style = MaterialTheme.typography.titleLarge,
                color = colors.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(label, style = MaterialTheme.typography.labelLarge, color = colors.onSurfaceVariant)
        }
    }
}

/**
 * #250 Pace edit: the timeline's header. A small Edit stops pill; while editing, Cancel and Save sit
 * on the same line and the cards below turn into editors.
 */
@Composable
private fun StopEditBar(model: PaceViewModel, onBegin: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(
        Modifier
            .testTag("crewcue.pace-stop-edit")
            .semantics { contentDescription = "Planned stops" },
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Kicker(
                if (model.stopEditing) "Editing planned stops" else "Aid stations",
                modifier = Modifier.weight(1f),
                color = if (model.stopEditing) colors.primary else colors.onSurfaceVariant
            )
            if (model.stopEditing) {
                PillButton(
                    "Cancel",
                    onClick = model::cancelStopEdit,
                    enabled = !model.stopBusy,
                    modifier = Modifier.testTag("crewcue.pace.cancel-stops")
                )
                PillButton(
                    "Save",
                    onClick = model::saveStops,
                    prominent = true,
                    enabled = model.stopCanSave,
                    busy = model.stopBusy,
                    spoken = "Save stops",
                    modifier = Modifier.testTag("crewcue.pace.save-stops")
                )
            } else if (model.mayEditStops) {
                PillButton(
                    "Edit stops",
                    onClick = onBegin,
                    icon = Icons.Outlined.Edit,
                    spoken = "Edit planned stops",
                    modifier = Modifier.testTag("crewcue.pace.edit-stops")
                )
            }
        }
        if (model.stopEditing) {
            Text(
                "Set the minutes at each aid ahead. Later arrivals move as you change them. Nothing saves until you tap Save.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant
            )
        }
        model.stopMessage?.let { line ->
            Text(
                line,
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
                modifier = Modifier
                    .testTag("crewcue.pace.stops-message")
                    .semantics { contentDescription = line }
            )
        }
    }
}

/**
 * One checkpoint while planned stops are being edited. Aids ahead of the runner get a dashed outline
 * and a minutes stepper; the start, the finish and passed aids are dimmed and locked.
 */
@Composable
private fun StopEditCard(
    row: TimelineRow,
    stop: PaceStop?,
    edit: StopEditRow?,
    onMinutes: (String) -> Unit,
    onStep: (Int) -> Unit
) {
    val colors = MaterialTheme.colorScheme
    val editable = edit?.editable == true
    val shape = RoundedCornerShape(16.dp)
    val lockedCaption = when {
        row.state == "done" -> "PASSED"
        row.isFinish -> "FINISH"
        else -> "LOCKED"
    }
    Column(
        Modifier
            .fillMaxWidth()
            .alpha(if (editable) 1f else 0.6f)
            .background(colors.surfaceContainerLowest.copy(alpha = if (editable) 1f else 0.6f), shape)
            .then(if (editable) Modifier.dashedBorder(colors.primary.copy(alpha = 0.7f), 16.dp, dash = 6.dp, gap = 4.dp) else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .semantics(mergeDescendants = false) { contentDescription = row.title },
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 8.dp)) {
                Text(row.kicker, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                Text(row.title, style = CardTitleStyle, color = colors.onSurface)
            }
            Column(horizontalAlignment = Alignment.End) {
                // The draft timeline's clock, so later arrivals move as the minutes change.
                Text(CrewClock.short(row.clockArrivalAt) ?: stop?.arrival ?: "—", style = CardClockStyle, color = colors.onSurface)
                Text(
                    if (editable) "ARRIVE" else lockedCaption,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceVariant
                )
            }
        }
        if (edit != null && editable) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("Planned stop", style = MaterialTheme.typography.labelLarge, color = colors.onSurface)
                    when {
                        edit.error != null -> Text(edit.error, style = MaterialTheme.typography.bodySmall, color = colors.error)
                        edit.changed -> Text(
                            "Was ${edit.savedLabel.lowercase()}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant
                        )
                    }
                }
                MinutesStepper(edit, onMinutes, onStep)
            }
        }
    }
}

/** − minutes + for one checkpoint's planned stop. */
@Composable
private fun MinutesStepper(row: StopEditRow, onMinutes: (String) -> Unit, onStep: (Int) -> Unit) {
    val colors = MaterialTheme.colorScheme
    val name = row.title.lowercase().replaceFirstChar { it.titlecase() }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        StepButton(Icons.Outlined.Remove, "One minute less at $name") { onStep(-1) }
        Row(
            Modifier
                .heightIn(min = 32.dp)
                .background(colors.surfaceContainerHigh.copy(alpha = 0.7f), RoundedCornerShape(8.dp))
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            BasicTextField(
                value = row.minutesText,
                onValueChange = onMinutes,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = colors.onSurface,
                    fontWeight = FontWeight.SemiBold,
                    fontFeatureSettings = "tnum",
                    textAlign = TextAlign.End
                ),
                cursorBrush = SolidColor(colors.primary),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier
                    .width(34.dp)
                    .testTag("crewcue.pace.stop-minutes.${row.checkpointId}")
                    .semantics { contentDescription = "Planned stop minutes at $name" }
            )
            Text("min", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
        }
        StepButton(Icons.Outlined.Add, "One minute more at $name") { onStep(1) }
    }
}

/** A round 32dp step button; its touch target is the full 48dp. */
@Composable
private fun StepButton(icon: ImageVector, spoken: String, onClick: () -> Unit) {
    Box(
        Modifier
            .minimumInteractiveComponentSize()
            .size(32.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = spoken },
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurface)
    }
}

private val EDIT_PANEL_RADIUS = 28.dp
/** A compact timeline card's title: headline-ish, wraps instead of shrinking. */
private val CardTitleStyle = androidx.compose.ui.text.TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.3.sp)
private val CardClockStyle = androidx.compose.ui.text.TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.ExtraBold, fontFeatureSettings = "tnum")

/** A dashed rounded outline, drawn inside the bounds. */
private fun Modifier.dashedBorder(color: Color, radius: Dp, width: Dp = 1.5.dp, dash: Dp = 7.dp, gap: Dp = 5.dp): Modifier =
    drawBehind {
        val stroke = width.toPx()
        drawRoundRect(
            color = color,
            topLeft = Offset(stroke / 2, stroke / 2),
            size = Size(size.width - stroke, size.height - stroke),
            cornerRadius = CornerRadius(radius.toPx()),
            style = Stroke(width = stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash.toPx(), gap.toPx())))
        )
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
/** Scrolls the tool a deeplink names into view when the sheet opens, as iOS does. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun bringIntoViewWhen(active: Boolean, contentAbove: Any? = null): Modifier {
    val requester = remember { BringIntoViewRequester() }
    // Content that loads after the sheet opens pushes later tools down, so ask again when it changes.
    LaunchedEffect(active, contentAbove) {
        if (active) requester.bringIntoView()
    }
    return Modifier.bringIntoViewRequester(requester)
}

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
        ProductCard(Modifier.testTag("crewcue.check-in").then(bringIntoViewWhen(focus == "check-in"))) {
            Text("Check in", style = MaterialTheme.typography.titleLarge)
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CrewTextField(model.checkpointId, model::updateCheckpoint, "Checkpoint")
                CrewTextField(model.arrival, model::updateArrival, "Arrival")
                CrewTextField(model.departure, model::updateDeparture, "Departure")
                model.checkInMessage?.let { line ->
                    Text(line, modifier = Modifier.semantics { contentDescription = line })
                }
                PillButton(
                    "Check in",
                    onClick = model::submitCheckIn,
                    modifier = Modifier.align(Alignment.End),
                    prominent = true,
                    busy = model.checkInBusy
                )
            }
        }
    }
    SettingsGroup("Pace", bringIntoViewWhen(focus == "pace-estimate" || focus == "cold-start")) {
        PaceEstimateRow(model)
    }
    SettingsGroup("Course", bringIntoViewWhen(focus == "gpx-import")) {
        var pasting by rememberSaveable { mutableStateOf(false) }
        SettingRow(
            Icons.Outlined.Map,
            "Course file",
            modifier = Modifier.testTag("crewcue.gpx-import"),
            hint = model.gpxMessage,
            trailing = {
                PillButton(
                    "Choose file",
                    onClick = { picker.launch(arrayOf("*/*")) },
                    prominent = true,
                    busy = model.gpxBusy,
                    spoken = "Choose route file"
                )
            },
            below = {
                Text(
                    if (pasting) "Hide GPX text" else "Paste GPX text instead",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable { pasting = !pasting }
                )
                if (pasting) {
                    CrewTextField(model.gpxText, model::updateGpxText, "GPX text", singleLine = false, minLines = 3)
                    PillButton("Import", onClick = model::importPastedGpx, busy = model.gpxBusy, spoken = "Import route")
                }
            }
        )
        RowDivider()
        SettingRow(
            Icons.Outlined.Schedule,
            "Aid station stops",
            modifier = Modifier
                .testTag("crewcue.course-settings")
                .then(bringIntoViewWhen(focus == "course-settings", model.exportText)),
            hint = listOfNotNull(model.stopSummary, model.courseMessage).joinToString(" "),
            below = if (model.courseStopRows.isEmpty()) null else {
                {
                    model.courseStopRows.forEach { (title, duration) ->
                        Row {
                            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Text(duration, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
            }
        )
        if (model.cutoffLines.isNotEmpty()) {
            RowDivider()
            SettingRow(
                Icons.Outlined.Flag,
                "Cutoffs",
                below = {
                    model.cutoffLines.forEach { line ->
                        Text(line, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { contentDescription = line })
                    }
                }
            )
        }
    }
    SettingsGroup("Share", bringIntoViewWhen(focus == "crew-sheet-export")) {
        SettingRow(
            Icons.AutoMirrored.Outlined.ListAlt,
            "Crew sheet",
            modifier = Modifier.testTag("crewcue.crew-sheet-export"),
            hint = model.exportMessage ?: "When the runner is due at each stop, for crew without the app.",
            trailing = if (model.exportText.isNullOrBlank()) null else {
                {
                    PillButton(
                        "Share",
                        onClick = { model.exportText?.let { shareCrewSheet(context, it) } },
                        prominent = true,
                        spoken = "Share crew sheet"
                    )
                }
            },
            below = if (model.crewSheetRows.isEmpty()) null else {
                { CrewSheetTable(model.crewSheetRows) }
            }
        )
    }
    SettingsGroup("This phone", bringIntoViewWhen(focus == "outbox-status", model.exportText)) {
        SettingRow(
            Icons.Outlined.CloudUpload,
            "Waiting to upload",
            modifier = Modifier.testTag("crewcue.outbox"),
            hint = "Check-ins, course files and messages made without signal wait here. They upload on their own once this phone is back online.",
            below = {
                model.outboxLines.forEach { line ->
                    Text(line, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { contentDescription = line })
                }
                model.outboxMessage?.takeIf { it.isNotBlank() }?.let { line ->
                    Text(line, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { contentDescription = line })
                }
            }
        )
    }
}

/** Stop, due time and race time in three aligned columns. */
@Composable
private fun CrewSheetTable(rows: List<CrewSheetRow>) {
    val colors = MaterialTheme.colorScheme
    Column(
        Modifier.semantics(mergeDescendants = true) { contentDescription = "Crew sheet" },
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Row {
            Text("STOP", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = colors.outline)
            Text("DUE", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = colors.outline, textAlign = TextAlign.End)
            Text("RACE TIME", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = colors.outline, textAlign = TextAlign.End)
        }
        rows.forEach { row ->
            Row {
                Text(row.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(row.arrival, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.End)
                Text(row.elapsed, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = colors.outline, textAlign = TextAlign.End)
            }
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
