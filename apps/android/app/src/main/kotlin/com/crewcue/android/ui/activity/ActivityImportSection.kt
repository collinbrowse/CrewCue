package com.crewcue.android.ui.activity

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
    ProductCard(
        modifier
            .testTag("crewcue.activity-import")
            .semantics { contentDescription = "Past runs" }
    ) {
        SectionHeader("Past runs")
        Text(
            "Import runs exported from Garmin, COROS, Suunto or another watch app. They improve the pace estimate.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            model.message,
            modifier = Modifier.padding(top = 8.dp).testTag("crewcue.activity-import.message")
                .semantics { contentDescription = model.message }
        )
        PrimaryButton(
            "Import past run",
            // FIT and TCX have no registered MIME type on most devices; the server checks the content.
            onClick = { picker.launch(arrayOf("*/*")) },
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.busy
        )
        model.items.forEach { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
    }
}

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
    var items by mutableStateOf<List<String>>(emptyList())
        private set
    var busy by mutableStateOf(false)
        private set

    fun refresh() {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.activityHistoryItems() }
            if (result is RuntimeResult.Success) {
                if (result.result.optBoolean("offline") && items.isEmpty()) message = ACTIVITY_IMPORT_OFFLINE
                result.result.optJSONArray("items")?.let { array ->
                    items = (0 until array.length()).mapNotNull { array.optJSONObject(it)?.optString("summary") }
                        .filter { it.isNotBlank() }
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
