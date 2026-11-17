package com.crewcue.android.ui.onboarding

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.text.format.DateFormat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimeInput
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.crewcue.android.BuildConfig
import com.crewcue.android.ui.brand.CairnShakeLoader
import com.crewcue.android.ui.map.CourseMaps
import com.crewcue.android.ui.map.CoursePoint
import com.crewcue.android.ui.theme.CrewClock
import com.crewcue.android.ui.theme.CrewTextField
import com.crewcue.android.ui.theme.LocalCrewExtras
import com.crewcue.android.ui.theme.MetricStyle
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Primary action. Unlike the shared button, the label wraps, so 200% font scale never clips it. */
@Composable
fun SetupPrimaryButton(label: String, tag: String, onClick: () -> Unit, enabled: Boolean = true, busy: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .testTag(tag)
            .semantics { contentDescription = label },
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.primary,
            contentColor = colors.onPrimary,
            disabledContainerColor = if (busy) colors.primary else colors.primary.copy(alpha = 0.4f),
            disabledContentColor = if (busy) colors.onPrimary else colors.onPrimary.copy(alpha = 0.8f)
        )
    ) {
        ButtonLabel(label, busy, onLight = LocalCrewExtras.current.dark)
    }
}

@Composable
fun SetupSecondaryButton(label: String, tag: String, onClick: () -> Unit, enabled: Boolean = true) {
    val colors = MaterialTheme.colorScheme
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .testTag(tag)
            .semantics { contentDescription = label },
        shape = CircleShape,
        border = BorderStroke(1.5.dp, colors.outline),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.onSurface)
    ) {
        ButtonLabel(label, busy = false, onLight = true)
    }
}

@Composable
private fun ButtonLabel(label: String, busy: Boolean, onLight: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (busy) CairnShakeLoader(modifier = Modifier.size(20.dp), onLight = onLight)
        // A label that wraps at a large font scale stays centred in the pill.
        Text(label, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center)
    }
}

/** The step's title and explanation, both client-core copy. */
@Composable
fun StepHeader(title: String, explanation: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onSurface)
        if (explanation.isNotBlank()) {
            Text(explanation, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A failure or offline line under the step, with Try again when the step can retry. */
@Composable
fun StatusLine(status: SetupStatus, text: OnboardingText, onRetry: (() -> Unit)?) {
    val failure = when (status) {
        is SetupStatus.Failed -> status.failure
        is SetupStatus.Offline -> status.failure
        else -> return
    }
    Column(
        Modifier.fillMaxWidth().testTag(setupTag("status")),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            failure.message,
            modifier = Modifier.semantics { contentDescription = failure.message },
            style = MaterialTheme.typography.bodyLarge,
            color = if (status is SetupStatus.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (failure.retryable && onRetry != null) {
            SetupSecondaryButton(text.label("tryAgain"), setupTag("retry"), onRetry)
        }
    }
}

/** A labelled value the runner taps to change: the date, the time or the zone. */
@Composable
fun FieldButton(label: String, value: String, tag: String, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag)
            .semantics(mergeDescendants = true) { contentDescription = "$label, $value" }
            .clickable(role = Role.Button, onClick = onClick),
        shape = MaterialTheme.shapes.small,
        color = colors.surfaceContainerLowest,
        border = BorderStroke(1.dp, colors.outlineVariant)
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleMedium, color = colors.onSurface)
        }
    }
}

/** The picked local date and time as the device shows dates. No zone conversion happens here. */
fun localDateLabel(fields: RaceStartFields): String =
    runCatching { DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).format(LocalDate.of(fields.year, fields.month, fields.day)) }
        .getOrDefault("")

fun localTimeLabel(fields: RaceStartFields): String =
    runCatching { DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).format(LocalTime.of(fields.hour, fields.minute)) }
        .getOrDefault("")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RaceDateDialog(fields: RaceStartFields, text: OnboardingText, onPick: (RaceStartFields) -> Unit, onDismiss: () -> Unit) {
    // The picker works in UTC midnights; only the calendar day is read back.
    val initial = runCatching {
        LocalDate.of(fields.year, fields.month, fields.day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    }.getOrNull()
    val state = rememberDatePickerState(initialSelectedDateMillis = initial)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    state.selectedDateMillis?.let { millis ->
                        val day = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()
                        onPick(fields.copy(year = day.year, month = day.monthValue, day = day.dayOfMonth))
                    }
                    onDismiss()
                },
                modifier = Modifier.testTag(setupTag("start.date.done"))
            ) { Text(text.label("done")) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(text.label("cancel")) } }
    ) {
        DatePicker(state = state, modifier = Modifier.testTag(setupTag("start.date.picker")))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RaceTimeDialog(fields: RaceStartFields, text: OnboardingText, onPick: (RaceStartFields) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val state = rememberTimePickerState(fields.hour, fields.minute, is24Hour = DateFormat.is24HourFormat(context))
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    onPick(fields.copy(hour = state.hour, minute = state.minute))
                    onDismiss()
                },
                modifier = Modifier.testTag(setupTag("start.time.done"))
            ) { Text(text.label("done")) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(text.label("cancel")) } },
        title = { Text(text.label("raceTime")) },
        // The keyboard input, not the dial: it stays inside the dialog at large font sizes.
        text = { TimeInput(state = state, modifier = Modifier.testTag(setupTag("start.time.picker"))) }
    )
}

/** IANA region zones the runner can pick, the device's first. client-core refuses abbreviations. */
fun pickableZones(deviceZone: String): List<String> {
    val regions = ZoneId.getAvailableZoneIds().filter { it.contains('/') && !it.startsWith("Etc/") && !it.startsWith("SystemV/") }.sorted()
    return listOf(deviceZone) + regions.filter { it != deviceZone } + listOf("UTC").filter { it != deviceZone }
}

@Composable
fun RaceZoneDialog(fields: RaceStartFields, deviceZone: String, text: OnboardingText, onPick: (RaceStartFields) -> Unit, onDismiss: () -> Unit) {
    var filter by rememberSaveable { mutableStateOf("") }
    val zones = remember(deviceZone) { pickableZones(deviceZone) }
    val shown = remember(filter, zones) {
        val needle = filter.trim().replace(' ', '_')
        if (needle.isEmpty()) zones else zones.filter { it.contains(needle, ignoreCase = true) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(text.label("cancel")) } },
        title = { Text(text.label("raceTimeZone")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CrewTextField(filter, { filter = it }, text.label("raceTimeZone"), Modifier.testTag(setupTag("start.zone.filter")))
                LazyColumn(Modifier.heightIn(max = 320.dp).testTag(setupTag("start.zone.list"))) {
                    items(shown, key = { it }) { zone ->
                        val selected = zone == fields.timeZone
                        Text(
                            zone.replace('_', ' '),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(role = Role.Button) {
                                    onPick(fields.copy(timeZone = zone))
                                    onDismiss()
                                }
                                .padding(vertical = 12.dp)
                                .testTag(setupTag("start.zone.option.$zone")),
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }
        }
    )
}

/**
 * The course on the map (MapLibre when this build has it, else a line sketch), with its elevation
 * profile from the route. Nothing here comes from this phone's location.
 */
@Composable
fun CourseMapPreview(course: CoursePreview, text: OnboardingText, modifier: Modifier = Modifier) {
    val renderer = CourseMaps.renderer
    var mapFailed by remember(course) { mutableStateOf(false) }
    Column(modifier.testTag(setupTag("preview.course")), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(240.dp)
                .testTag(setupTag("preview.map"))
                .semantics { contentDescription = text.label("coursePreview") },
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surfaceContainer
        ) {
            if (BuildConfig.MAP_LIBRE && renderer != null && !mapFailed) {
                renderer.Render(
                    course.checkpoints,
                    course.line,
                    emptyList(),
                    Modifier.fillMaxSize(),
                    { _, _ -> },
                    {},
                    { mapFailed = true },
                    { mapFailed = true },
                    0
                )
            } else {
                RouteSketch(course.line, Modifier.fillMaxSize().padding(16.dp))
            }
        }
        if (course.elevation.size >= 2) {
            ElevationProfile(course.elevation, text.label("elevation"))
        }
    }
}

@Composable
private fun RouteSketch(line: List<CoursePoint>, modifier: Modifier) {
    val ink = MaterialTheme.colorScheme.primary
    Canvas(modifier) {
        if (line.size < 2) return@Canvas
        val minLat = line.minOf { it.latitude }
        val maxLat = line.maxOf { it.latitude }
        val minLon = line.minOf { it.longitude }
        val maxLon = line.maxOf { it.longitude }
        val span = maxOf(maxLat - minLat, maxLon - minLon).takeIf { it > 0 } ?: return@Canvas
        val scale = minOf(size.width, size.height) / span.toFloat()
        val path = Path()
        line.forEachIndexed { index, point ->
            val x = ((point.longitude - minLon) * scale).toFloat()
            val y = size.height - ((point.latitude - minLat) * scale).toFloat()
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, ink, style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** The elevation along the course, from the route geometry (an unpaid race has no plan curve). */
@Composable
fun ElevationProfile(samples: List<Pair<Double, Double>>, label: String) {
    val ink = MaterialTheme.colorScheme.primary
    val fill = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
    Column(Modifier.fillMaxWidth().testTag(setupTag("preview.elevation")).semantics { contentDescription = label }) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Canvas(Modifier.fillMaxWidth().height(88.dp).padding(top = 8.dp)) {
            val maxDistance = samples.last().first.takeIf { it > 0 } ?: return@Canvas
            val low = samples.minOf { it.second }
            val high = samples.maxOf { it.second }
            val rise = (high - low).takeIf { it > 0 } ?: 1.0
            fun at(sample: Pair<Double, Double>) = Offset(
                (sample.first / maxDistance * size.width).toFloat(),
                (size.height - (sample.second - low) / rise * size.height).toFloat()
            )
            val line = Path()
            samples.forEachIndexed { index, sample ->
                val point = at(sample)
                if (index == 0) line.moveTo(point.x, point.y) else line.lineTo(point.x, point.y)
            }
            val area = Path().apply {
                addPath(line)
                lineTo(size.width, size.height)
                lineTo(0f, size.height)
                close()
            }
            drawPath(area, fill)
            drawPath(line, ink, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
        }
    }
}

/** One teaser row: the start and finish with their plan clock, every other checkpoint locked. */
@Composable
fun TeaserRowCard(row: TeaserRow, text: OnboardingText) {
    val colors = MaterialTheme.colorScheme
    val (title, kicker, value, locked) = when (row) {
        is TeaserRow.Open -> Quad(row.row.title, row.row.kicker, CrewClock.short(row.row.clockArrivalAt) ?: "—", false)
        is TeaserRow.Locked -> Quad(row.title, "", text.label("locked"), true)
    }
    val finish = row is TeaserRow.Open && row.row.isFinish
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(setupTag(if (locked) "teaser.locked.${row.checkpointId}" else "teaser.row.${row.checkpointId}"))
            .semantics(mergeDescendants = true) { contentDescription = "$title, $value" },
        shape = MaterialTheme.shapes.medium,
        color = if (finish) colors.surfaceContainer else colors.surfaceContainerLowest,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.6f))
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                when {
                    locked -> Icons.Outlined.Lock
                    finish -> Icons.Outlined.Flag
                    else -> Icons.Outlined.Place
                },
                contentDescription = null,
                tint = if (locked) colors.onSurfaceVariant else colors.primary
            )
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                if (kicker.isNotBlank()) {
                    Text(kicker, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                }
                Text(title, style = MaterialTheme.typography.titleMedium, color = if (locked) colors.onSurfaceVariant else colors.onSurface)
            }
            Text(
                value,
                style = if (locked) MaterialTheme.typography.labelLarge else MetricStyle,
                color = when {
                    locked -> colors.onSurfaceVariant
                    finish -> colors.primary
                    else -> colors.onSurface
                }
            )
        }
    }
}

private data class Quad(val title: String, val kicker: String, val value: String, val locked: Boolean)

/** A centred loader for a step that is reading the server. */
@Composable
fun SetupLoader(tag: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 32.dp).testTag(tag), contentAlignment = Alignment.Center) {
        com.crewcue.android.ui.brand.CairnLoader(modifier = Modifier.size(64.dp), onLight = !LocalCrewExtras.current.dark)
    }
}

/** Display name and text of a picked course file, or a null text when it can't be read or is too large. */
fun readCourseFile(context: Context, uri: Uri): Pair<String, String?> {
    val name = displayName(context, uri, fallback = "route.gpx")
    val text = runCatching {
        context.contentResolver.openInputStream(uri)?.use { stream -> stream.bufferedReader(Charsets.UTF_8).use { it.readText() } }
    }.getOrNull()
    return name to text?.takeIf { it.length <= MAX_COURSE_CHARS }
}

/** Display name and base64 content of a history file, or a null content when unreadable or too large. */
fun readHistoryFile(context: Context, uri: Uri): Pair<String, String?> {
    val name = displayName(context, uri, fallback = "activity")
    val bytes = runCatching {
        context.contentResolver.openInputStream(uri)?.use { stream ->
            val out = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(64 * 1024)
            // One byte past the limit: client-core then reports the file as too large.
            while (out.size() <= MAX_HISTORY_BYTES) {
                val read = stream.read(chunk)
                if (read < 0) break
                out.write(chunk, 0, read)
            }
            out.toByteArray()
        }
    }.getOrNull()
    return name to bytes?.let { java.util.Base64.getEncoder().encodeToString(it) }
}

private fun displayName(context: Context, uri: Uri, fallback: String): String {
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val name = cursor.getString(0)
                if (!name.isNullOrBlank()) return name
            }
        }
    }
    return uri.lastPathSegment ?: fallback
}

/** The server's GPX limit (`MAX_GPX_XML_CHARS` in services/api/src/lib/gpxLimits.ts). */
private const val MAX_COURSE_CHARS = 10 * 1024 * 1024

/** client-core `ActivityImport.maxFileBytes`. */
private const val MAX_HISTORY_BYTES = 10 * 1024 * 1024
