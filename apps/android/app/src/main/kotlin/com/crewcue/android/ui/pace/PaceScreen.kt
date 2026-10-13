package com.crewcue.android.ui.pace

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight
import com.crewcue.android.ui.theme.ProductCard
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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

@Composable
fun PaceScreen(shell: ShellViewModel, roomId: String, modifier: Modifier = Modifier) {
    val model: PaceViewModel = viewModel(
        key = "pace-$roomId",
        factory = PaceViewModelFactory(shell.container.raceDay, roomId)
    )
    LaunchedEffect(roomId) { model.load() }
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
        Text("Schedule", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        model.scheduleMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
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

        SectionTitle("Estimate")
        model.estimateMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.estimateDetail?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        if (model.mayRecalculate) {
            Button(
                onClick = model::recalculate,
                enabled = !model.estimateBusy,
                modifier = Modifier
                    .padding(top = 12.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Recalculate" }
            ) {
                Text("Recalculate")
            }
        }

        SectionTitle("Check in")
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
        Button(
            onClick = model::submitCheckIn,
            enabled = !model.checkInBusy,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Check in" }
        ) {
            Text("Check in")
        }

        SectionTitle("Route file")
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
        Button(
            onClick = { picker.launch(arrayOf("*/*")) },
            enabled = !model.gpxBusy,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Choose route file" }
        ) {
            Text("Choose file")
        }
        Button(
            onClick = model::importPastedGpx,
            enabled = !model.gpxBusy,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Import route" }
        ) {
            Text("Import")
        }

        SectionTitle("Crew sheet")
        model.exportMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.exportText?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = "Crew sheet" })
        }
        Button(
            onClick = { model.exportText?.let { shareCrewSheet(context, it) } },
            enabled = !model.exportText.isNullOrBlank(),
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Share crew sheet" }
        ) {
            Text("Share")
        }

        SectionTitle("Course settings")
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
        Button(
            onClick = model::saveCourse,
            enabled = !model.courseBusy,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Save course settings" }
        ) {
            Text("Save draft")
        }

        SectionTitle("Outbox")
        model.outboxMessage?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.outboxLines.forEach { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, modifier = Modifier.padding(top = 20.dp).semantics { contentDescription = text })
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
