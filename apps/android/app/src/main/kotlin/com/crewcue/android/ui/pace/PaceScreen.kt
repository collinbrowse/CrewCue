package com.crewcue.android.ui.pace

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle
import com.crewcue.android.ui.theme.SecondaryButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.ui.ShellViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PaceScreen(
    shell: ShellViewModel,
    roomId: String,
    modifier: Modifier = Modifier,
    focus: String = "schedule-sheet"
) {
    val model: PaceViewModel = viewModel(
        key = "pace-$roomId",
        factory = PaceViewModelFactory(shell.container.raceDay, roomId)
    )
    LaunchedEffect(roomId) { model.load() }
    val tools = remember { BringIntoViewRequester() }
    val checkIn = remember { BringIntoViewRequester() }
    LaunchedEffect(focus, model.scheduleStops) {
        if (focus == "check-in") {
            model.scheduleStops.firstOrNull()?.let { model.openCheckIn(it.id) }
            checkIn.bringIntoView()
        }
        if (focus in setOf("gpx-import", "crew-sheet-export", "course-settings", "outbox-status")) {
            tools.bringIntoView()
        }
    }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val payload = withContext(Dispatchers.IO) { readGpx(context, uri) }
            if (payload == null) model.gpxUnreadable() else model.importGpx(payload.first, payload.second)
        }
    }
    Column(
        modifier
            .testTag("crewcue.schedule-sheet")
            .semantics { contentDescription = "Schedule" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        ProductTitle("Schedule", "Arrival times for each aid.")
        model.scheduleMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        val stops = model.scheduleStops
        if (stops.isEmpty()) {
            model.scheduleLines.forEachIndexed { index, line ->
                ProductCard(Modifier.padding(top = 12.dp)) {
                    Text("${index + 1}", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        line,
                        modifier = Modifier.padding(top = 6.dp).semantics { contentDescription = line },
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleMedium
                    )
                }
            }
        } else {
            stops.forEach { stop ->
                ProductCard(Modifier.padding(top = 12.dp).semantics { contentDescription = stop.line }) {
                    Text(stop.title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Text("Arrival ${stop.arrival}", modifier = Modifier.padding(top = 4.dp))
                    Text("Elapsed ${stop.elapsed}")
                    if (stop.moving != null && stop.waited != null) {
                        Text("Moving ${stop.moving} · Waited ${stop.waited}")
                    }
                    Text("Stoppage ${stop.stoppage}")
                    stop.delay?.let { Text("Delay $it") }
                    SecondaryButton(
                        "Check in",
                        onClick = { model.openCheckIn(stop.id) },
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
        }

        ProductCard(
            Modifier
                .padding(top = 20.dp)
                .testTag("crewcue.pace-estimate")
                .semantics { contentDescription = "Pace estimate" }
        ) {
            Text("Pace estimate", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
            model.estimateMessage?.let { line ->
                Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
            }
            model.estimateDetail?.let { line ->
                Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
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

        if (model.checkInOpen || focus == "check-in") {
        ProductCard(Modifier.padding(top = 16.dp).bringIntoViewRequester(checkIn).testTag("crewcue.check-in")) {
        Text("Check in", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(
            value = model.checkpointId,
            onValueChange = model::updateCheckpoint,
            label = { Text("Checkpoint") },
            singleLine = true,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Checkpoint" }
        )
        OutlinedTextField(
            value = model.arrival,
            onValueChange = model::updateArrival,
            label = { Text("Arrival") },
            placeholder = { Text("2026-08-15T14:10:00.000Z") },
            singleLine = true,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Arrival" }
        )
        OutlinedTextField(
            value = model.departure,
            onValueChange = model::updateDeparture,
            label = { Text("Departure") },
            placeholder = { Text("2026-08-15T14:16:00.000Z") },
            singleLine = true,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Departure" }
        )
        model.checkInMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        PrimaryButton(
            "Check in",
            onClick = model::submitCheckIn,
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.checkInBusy
        )
        }
        }

        Column(Modifier.padding(top = 24.dp).bringIntoViewRequester(tools)) {
            ProductTitle(
                "Crew tools",
                "Import a route, share the sheet, and keep drafts on this phone."
            )
        }
        ProductCard(Modifier.padding(top = 12.dp).testTag("crewcue.gpx-import")) {
        Text("Route file", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
        Text(
            model.gpxMessage,
            modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.gpxMessage }
        )
        OutlinedTextField(
            value = model.gpxText,
            onValueChange = model::updateGpxText,
            label = { Text("GPX") },
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "GPX" }
        )
        SecondaryButton(
            "Choose file",
            onClick = { picker.launch(arrayOf("*/*")) },
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.gpxBusy,
            spoken = "Choose route file"
        )
        PrimaryButton(
            "Import",
            onClick = model::importPastedGpx,
            modifier = Modifier.padding(top = 8.dp),
            enabled = !model.gpxBusy,
            spoken = "Import route"
        )
        }

        ProductCard(Modifier.padding(top = 12.dp).testTag("crewcue.crew-sheet-export")) {
        Text("Crew sheet", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
        model.exportMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.exportText?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = "Crew sheet" })
        }
        PrimaryButton(
            "Share",
            onClick = { model.exportText?.let { shareCrewSheet(context, it) } },
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.exportText.isNullOrBlank(),
            spoken = "Share crew sheet"
        )
        }

        ProductCard(Modifier.padding(top = 12.dp).testTag("crewcue.course-settings")) {
        Text("Course settings", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
        model.courseMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        OutlinedTextField(
            value = model.cutoffNote,
            onValueChange = model::updateCutoff,
            label = { Text("Cutoff") },
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Cutoff" }
        )
        OutlinedTextField(
            value = model.stoppageText,
            onValueChange = model::updateStoppage,
            label = { Text("Stoppage seconds") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Stoppage seconds" }
        )
        PrimaryButton(
            "Save draft",
            onClick = model::saveCourse,
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.courseBusy,
            spoken = "Save course settings"
        )
        }

        ProductCard(Modifier.padding(top = 12.dp).testTag("crewcue.outbox")) {
        Text("Outbox", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
        model.outboxMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.outboxLines.forEach { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
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
