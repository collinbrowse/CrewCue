package com.crewcue.android.ui.activity

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import com.crewcue.android.ui.theme.PillButton
import com.crewcue.android.ui.theme.SettingRow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.DirectionsRun
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import com.crewcue.android.ui.theme.RowDivider
import com.crewcue.android.ui.theme.RowTitleStyle
import com.crewcue.android.ui.theme.ToolSheet
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.SectionHeader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Copy mirrors client-core `ActivityImport` and `clients/behavior/activity-import.md`. */
const val ACTIVITY_IMPORT_EMPTY = "Choose a .gpx, .fit or .tcx file from your watch."
const val ACTIVITY_IMPORT_ERROR = "Couldn't read that file. Choose a .gpx, .fit or .tcx export."
const val ACTIVITY_IMPORT_OFFLINE = "Offline. Import the file when you're back online."

/** Matches client-core `ActivityImport.maxFileBytes`; bigger files are refused before reading them all. */
private const val MAX_FILE_BYTES = 10 * 1024 * 1024

/** Settings → Past runs: import an exported .gpx, .fit or .tcx into pacing history (#652). */
@Composable
fun ActivityImportSection(shell: ShellViewModel, modifier: Modifier = Modifier) {
    val model: ActivityImportViewModel = viewModel(
        key = "activity-import-${shell.session?.userId}",
        factory = ActivityImportViewModelFactory(shell.container.raceDay)
    )
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val file = withContext(Dispatchers.IO) { readFile(context, uri) }
            if (file == null) model.unreadable() else model.import(file.first, file.second)
        }
    }
    LaunchedEffect(shell.session?.userId) { model.refresh() }
    var showsRuns by rememberSaveable { mutableStateOf(false) }
    SettingRow(
        Icons.Outlined.Download,
        "Import your training history",
        modifier = modifier
            .testTag("crewcue.activity-import")
            .semantics { contentDescription = "Training history" },
        hint = if (model.message.isBlank() || model.message == ACTIVITY_IMPORT_EMPTY) ACTIVITY_IMPORT_HINT else model.message,
        trailing = {
            PillButton(
                "Import",
                // FIT and TCX have no registered MIME type on most devices; the server checks the content.
                onClick = { picker.launch(arrayOf("*/*")) },
                prominent = true,
                busy = model.busy,
                spoken = "Import past run"
            )
        },
        below = if (model.items.isEmpty()) null else {
            {
                // One line about the history; the runs themselves open in a sheet.
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 36.dp)
                        .clickable(role = Role.Button, onClickLabel = "Show each imported run") { showsRuns = true }
                        .testTag("crewcue.activity-import.runs")
                        .semantics(mergeDescendants = true) { contentDescription = model.countLabel },
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        model.countLabel,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f)
                    )
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline
                    )
                }
            }
        }
    )
    if (showsRuns) {
        val session = shell.session
        ImportedRunsSheet(
            model,
            canRecalculate = recalculatesOwnHistory(session?.roomId, session?.role),
            roomId = session?.roomId,
            onDismiss = {
                showsRuns = false
                model.dismissRemovalStatus()
            }
        )
    }
}

/**
 * Every run in the pacing history, newest first, with its distance, time and pace. Swipe a run
 * left and confirm to remove it, so it stops shaping the pace estimate.
 */
@Composable
fun ImportedRunsSheet(model: ActivityImportViewModel, canRecalculate: Boolean, roomId: String?, onDismiss: () -> Unit) {
    LaunchedEffect(Unit) { model.loadRemovalCopy() }
    val copy = model.removalCopy
    val items = model.items
    ToolSheet(title = "Imported runs", onDismiss = onDismiss) {
        Column(Modifier.testTag("crewcue.activity-import.list"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (items.isEmpty()) model.countLabel else "${model.countLabel}. Each one shapes your pace estimate.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(horizontal = 8.dp)
            )
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceContainerLowest
            ) {
                Column(Modifier.padding(vertical = 4.dp)) {
                    ImportedRun.newestFirst(items).forEachIndexed { index, item ->
                        if (index > 0) Box(Modifier.padding(horizontal = 16.dp)) { RowDivider() }
                        key(item.id) {
                            RemovableRunRow(item, copy, removing = model.removingId == item.id, onRemove = { model.pendingRemoval = it }) {
                                Box(Modifier.padding(horizontal = 16.dp)) { ImportedRunRow(item) }
                            }
                        }
                    }
                }
            }
            model.removalMessage?.let { message ->
                RemovalStatus(message, model.offersRecalculate, model.recalculating, copy) {
                    roomId?.let(model::recalculate)
                }
            }
        }
    }
    model.pendingRemoval?.let { item ->
        RemoveRunDialog(
            copy,
            onConfirm = { model.remove(item, canRecalculate) },
            onDismiss = { model.pendingRemoval = null }
        )
    }
}

@Composable
private fun ImportedRunRow(item: ImportedRun) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.Top
    ) {
        Icon(
            Icons.AutoMirrored.Outlined.DirectionsRun,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(28.dp).padding(2.dp)
        )
        Column(Modifier.weight(1f).padding(start = 12.dp, end = 8.dp)) {
            // A named run ("Morning Run") shows its name over the date; others show the date.
            Text(item.titleLabel, style = RowTitleStyle, color = MaterialTheme.colorScheme.onSurface, maxLines = 2)
            Text(item.subtitleLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                item.totalsLabel,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"),
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.End
            )
            item.paceLabel?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.outline,
                    textAlign = TextAlign.End
                )
            }
        }
    }
}

/** One row of client-core's activity history; every label is formatted there. */
data class ImportedRun(
    val id: String,
    val recordedAt: String,
    val summary: String,
    val sourceLabel: String,
    val dateLabel: String,
    val distanceLabel: String?,
    val durationLabel: String?,
    val paceLabel: String?,
    /** The activity's own name from the file, when it had one. */
    val name: String? = null,
    /** client-core's title: the name, else the date. */
    val titleLabel: String = name ?: dateLabel,
    /** The date under a named run's title; null when the title is the date. */
    val subtitleDateLabel: String? = null
) {
    /** "6.2 mi · 1:02:10" */
    val totalsLabel: String get() = listOfNotNull(distanceLabel, durationLabel).joinToString(" · ")

    /** "May 10, 2026 · GPX" under a named run, "GPX" under a dated one. */
    val subtitleLabel: String get() = listOfNotNull(subtitleDateLabel, sourceLabel).joinToString(" · ")

    companion object {
        fun parse(json: JSONObject): ImportedRun? {
            val id = json.optString("id").ifBlank { return null }
            val recordedAt = json.optString("recordedAt")
            val dateLabel = json.optString("dateLabel").ifBlank { recordedAt.take(10) }
            return ImportedRun(
                id = id,
                recordedAt = recordedAt,
                summary = json.optString("summary"),
                sourceLabel = json.optString("sourceLabel").ifBlank { json.optString("source") },
                dateLabel = dateLabel,
                distanceLabel = json.optLabel("distanceLabel"),
                durationLabel = json.optLabel("durationLabel"),
                paceLabel = json.optLabel("paceLabel"),
                name = json.optLabel("name"),
                titleLabel = json.optLabel("titleLabel") ?: json.optLabel("name") ?: dateLabel,
                subtitleDateLabel = json.optLabel("subtitleDateLabel")
            )
        }

        fun parseList(json: JSONObject): List<ImportedRun> {
            val array = json.optJSONArray("items") ?: return emptyList()
            return (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::parse) }
        }

        /** Newest first by the recorded instant (ISO-8601 sorts as text). */
        fun newestFirst(items: List<ImportedRun>): List<ImportedRun> = items.sortedByDescending { it.recordedAt }

        private fun JSONObject.optLabel(key: String): String? =
            if (isNull(key)) null else optString(key).ifBlank { null }
    }
}

const val ACTIVITY_IMPORT_HINT = "Runs from Garmin, COROS, Suunto or any watch app (.gpx, .fit, .tcx). They sharpen your estimate."

/** Display name and bytes, or null when the file can't be read or is over the size limit. */
private fun readFile(context: Context, uri: Uri): Pair<String, ByteArray>? {
    return try {
        val name = displayName(context, uri)
        // Read at most one byte past the limit: client-core then reports the file as too large.
        val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
            val out = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(64 * 1024)
            while (out.size() <= MAX_FILE_BYTES) {
                val read = stream.read(chunk)
                if (read < 0) break
                out.write(chunk, 0, read)
            }
            out.toByteArray()
        } ?: return null
        name to bytes
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
    return uri.lastPathSegment ?: "activity"
}

class ActivityImportViewModel(private val raceDay: RaceDayBridge) : ViewModel() {
    var message by mutableStateOf(ACTIVITY_IMPORT_EMPTY)
        private set
    var items by mutableStateOf<List<ImportedRun>>(emptyList())
        private set
    /** "3 runs imported", from client-core. */
    var countLabel by mutableStateOf("")
        private set
    var busy by mutableStateOf(false)
        private set
    /** The run waiting on the Remove confirm. Kept here so a fold or rotation keeps the dialog. */
    var pendingRemoval by mutableStateOf<ImportedRun?>(null)
    var removingId by mutableStateOf<String?>(null)
        private set
    var removalMessage by mutableStateOf<String?>(null)
        private set
    var offersRecalculate by mutableStateOf(false)
        private set
    var recalculating by mutableStateOf(false)
        private set
    var removalCopy by mutableStateOf(RunRemovalCopy())
        private set
    private var removalCopyLoaded = false

    fun loadRemovalCopy() {
        if (removalCopyLoaded) return
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.activityDeleteCopy() }
            if (result is RuntimeResult.Success) {
                removalCopy = RunRemovalCopy.parse(result.result)
                removalCopyLoaded = true
            }
        }
    }

    /** The runner confirmed: remove the run, reload the list, and offer Recalculate for their own race. */
    fun remove(item: ImportedRun, canRecalculate: Boolean) {
        pendingRemoval = null
        if (removingId != null) return
        viewModelScope.launch {
            removingId = item.id
            offersRecalculate = false
            try {
                val result = withContext(Dispatchers.IO) { raceDay.deleteActivity(item.id) }
                val outcome = RemovalOutcome.of(result, removalCopy, canRecalculate)
                if (outcome.removed) items = items.filterNot { it.id == item.id }
                removalMessage = outcome.message
                offersRecalculate = outcome.offersRecalculate
                if (outcome.removed) refresh()
            } finally {
                removingId = null
            }
        }
    }

    /**
     * Recalculate the open race's estimate without the removed run. `loadEstimate` reads the new
     * history fingerprint first, so Pace records it and does not recompute again on its own.
     */
    fun recalculate(roomId: String) {
        if (recalculating) return
        viewModelScope.launch {
            recalculating = true
            try {
                val attached = withContext(Dispatchers.IO) {
                    val loaded = raceDay.loadEstimate(roomId)
                    val loadedJson = (loaded as? RuntimeResult.Success)?.result
                    val fingerprint = loadedJson?.optString("historyFingerprint")?.ifBlank { null }
                    val usable = loadedJson?.optInt("usableHistoryCount") ?: items.size
                    raceDay.computeEstimate(roomId, fingerprint, usable, "recalculate", hasPlanOfRecord = true)
                } is RuntimeResult.Success
                offersRecalculate = !attached
                removalMessage = if (attached) removalCopy.recalculatedMessage else removalCopy.recalculateFailedMessage
            } finally {
                recalculating = false
            }
        }
    }

    /** The runs sheet closed: drop its one-off status. */
    fun dismissRemovalStatus() {
        removalMessage = null
        offersRecalculate = false
        pendingRemoval = null
    }

    fun refresh() {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.activityHistoryItems() }
            if (result is RuntimeResult.Success) {
                if (result.result.optBoolean("offline") && items.isEmpty()) message = ACTIVITY_IMPORT_OFFLINE
                if (result.result.has("items")) {
                    items = ImportedRun.parseList(result.result)
                    countLabel = result.result.optString("countLabel").ifBlank { countLabelFallback(items.size) }
                }
            }
        }
    }

    fun unreadable() {
        message = ACTIVITY_IMPORT_ERROR
    }

    fun import(fileName: String, bytes: ByteArray) {
        if (busy) return
        viewModelScope.launch {
            busy = true
            message = "Importing $fileName…"
            try {
                val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
                val result = withContext(Dispatchers.IO) { raceDay.importActivityFile(fileName, encoded) }
                message = messageFor(result)
                if (result is RuntimeResult.Success && result.result.optString("status") in setOf("saved", "duplicate")) {
                    refresh()
                }
            } finally {
                busy = false
            }
        }
    }

    companion object {
        /** Only for an older runtime without `countLabel`; client-core owns this copy. */
        fun countLabelFallback(count: Int): String = when {
            count < 1 -> "No runs imported yet"
            count == 1 -> "1 run imported"
            else -> "$count runs imported"
        }

        /** client-core returns the user-facing message for every status, server errors included. */
        fun messageFor(result: RuntimeResult): String = when (result) {
            is RuntimeResult.Failure -> if (result.offline) ACTIVITY_IMPORT_OFFLINE else ACTIVITY_IMPORT_ERROR
            is RuntimeResult.Success -> messageFor(result.result)
        }

        fun messageFor(json: JSONObject): String =
            json.optString("message").ifBlank {
                if (json.optString("status") == "offline") ACTIVITY_IMPORT_OFFLINE else ACTIVITY_IMPORT_ERROR
            }
    }
}

class ActivityImportViewModelFactory(private val raceDay: RaceDayBridge) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = ActivityImportViewModel(raceDay) as T
}
