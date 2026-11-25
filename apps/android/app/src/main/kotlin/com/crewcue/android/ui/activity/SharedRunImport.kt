package com.crewcue.android.ui.activity

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.compose.foundation.Canvas
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.theme.GhostButton
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.SecondaryButton
import com.crewcue.android.ui.theme.ToolSheet
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.cos

/** Copy mirrors client-core `SharedRunImport` and `clients/behavior/run-share-import.md`. */
const val RUN_SHARE_TIP = "Export a run from your watch app and share it to CrewCue."
const val RUN_SHARE_READING = "Reading your run…"
const val RUN_SHARE_IMPORTING = "Importing…"
const val RUN_SHARE_UNREADABLE = "Couldn't read that file. Choose a .gpx, .fit, .tcx or .zip export."

/** Matches client-core `SharedRunImport.maxUploadBytes`; bigger files are refused before reading them all. */
private const val MAX_UPLOAD_BYTES = 200L * 1024 * 1024

/** One labeled value in a preview row ("Distance" over "14.6 km"), worded by client-core. */
data class SharedRunDetail(val label: String, val value: String)

data class SharedRun(
    val dateLabel: String,
    val details: List<SharedRunDetail>,
    val spokenSummary: String,
    val alreadyImported: Boolean,
    val track: List<Pair<Double, Double>>
)

/** What the sheet shows. Mirrors client-core `SharedRunImportState`. */
sealed interface SharedRunUi {
    data object Reading : SharedRunUi
    data object Importing : SharedRunUi
    data class Message(val text: String, val signedOut: Boolean = false) : SharedRunUi
    data class Preview(
        val title: String,
        val confirmLabel: String,
        val canImport: Boolean,
        val runs: List<SharedRun>,
        val unreadableLine: String?,
        val unreadable: List<String>,
        val skippedLine: String? = null,
        /** Runs listed before Show more. */
        val firstListedRuns: Int = 10,
        /** "Show 164 more", or null when every run fits. */
        val showMoreLabel: String? = null,
        val alreadyImportedBadge: String = "Already imported"
    ) : SharedRunUi
}

/** run-share-import: a run file shared or opened in CrewCue, previewed, then imported on confirm. */
class SharedRunImportViewModel(private val raceDay: RaceDayBridge) : ViewModel() {
    var ui by androidx.compose.runtime.mutableStateOf<SharedRunUi?>(null)
        private set
    /** The runner tapped Show more. Held here so a fold or rotation keeps the list open. */
    var showsAllRuns by androidx.compose.runtime.mutableStateOf(false)
        private set

    fun showAllRuns() {
        showsAllRuns = true
    }
    /** Display name and the cached copy's path, held between preview and confirm. */
    private var file: Pair<String, String>? = null
    private var ticket = 0

    /** [path] is a readable copy of the shared file, or null when the sender didn't let CrewCue read it. */
    fun receive(fileName: String, path: String?, signedIn: Boolean) {
        ticket += 1
        showsAllRuns = false
        val mine = ticket
        if (path == null && signedIn) {
            // The sending app didn't let CrewCue read the file.
            file = null
            ui = SharedRunUi.Message(RUN_SHARE_UNREADABLE)
            return
        }
        val filePath = path.orEmpty()
        file = fileName to filePath
        ui = SharedRunUi.Reading
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.previewActivityUpload(fileName, filePath, signedIn) }
            if (mine != ticket) return@launch
            ui = uiFor(result)
            if (ui !is SharedRunUi.Preview) file = null
        }
    }

    fun showTip() {
        ticket += 1
        showsAllRuns = false
        file = null
        ui = SharedRunUi.Message(RUN_SHARE_TIP)
    }

    fun confirm() {
        val preview = ui as? SharedRunUi.Preview ?: return
        val (name, path) = file ?: return
        if (!preview.canImport) return
        val mine = ticket
        ui = SharedRunUi.Importing
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.importActivityUpload(name, path) }
            if (mine != ticket) return@launch
            ui = uiFor(result)
            file = null
        }
    }

    fun dismiss() {
        ticket += 1
        showsAllRuns = false
        ui = null
        file = null
    }

    companion object {
        fun uiFor(result: RuntimeResult): SharedRunUi = when (result) {
            is RuntimeResult.Failure -> SharedRunUi.Message(if (result.offline) ACTIVITY_IMPORT_OFFLINE else RUN_SHARE_UNREADABLE)
            is RuntimeResult.Success -> uiFor(result.result)
        }

        fun uiFor(json: JSONObject): SharedRunUi = when (json.optString("state")) {
            "signedOut" -> SharedRunUi.Message(json.optString("message"), signedOut = true)
            "preview" -> {
                val runs = json.optJSONArray("runs")
                val unreadable = json.optJSONArray("unreadable")
                SharedRunUi.Preview(
                    title = json.optString("title"),
                    confirmLabel = json.optString("confirmLabel"),
                    canImport = json.optBoolean("canImport"),
                    runs = (0 until (runs?.length() ?: 0)).mapNotNull { index ->
                        val run = runs?.optJSONObject(index) ?: return@mapNotNull null
                        val track = run.optJSONArray("track")
                        val details = run.optJSONArray("details")
                        SharedRun(
                            dateLabel = run.optString("dateLabel"),
                            details = (0 until (details?.length() ?: 0)).mapNotNull { i ->
                                val d = details?.optJSONObject(i) ?: return@mapNotNull null
                                SharedRunDetail(d.optString("label"), d.optString("value"))
                            },
                            spokenSummary = run.optString("spokenSummary"),
                            alreadyImported = run.optBoolean("alreadyImported"),
                            track = (0 until (track?.length() ?: 0)).mapNotNull { i ->
                                val pair = track?.optJSONArray(i) ?: return@mapNotNull null
                                if (pair.length() == 2) pair.optDouble(0) to pair.optDouble(1) else null
                            }
                        )
                    },
                    unreadableLine = json.optString("unreadableLine").ifBlank { null },
                    firstListedRuns = json.optInt("firstListedRuns", 10),
                    showMoreLabel = json.optString("showMoreLabel").ifBlank { null },
                    alreadyImportedBadge = json.optString("alreadyImportedBadge").ifBlank { "Already imported" },
                    skippedLine = json.optString("skippedLine").ifBlank { null },
                    unreadable = (0 until (unreadable?.length() ?: 0)).mapNotNull { index ->
                        unreadable?.optJSONObject(index)?.let { "${it.optString("fileName")}: ${it.optString("error")}" }
                    }
                )
            }
            else -> SharedRunUi.Message(json.optString("message").ifBlank { RUN_SHARE_UNREADABLE })
        }

        /** A shared (SEND) or opened (VIEW) file, as opposed to a crewcue:// link. */
        fun sharedUri(intent: Intent?): Uri? {
            intent ?: return null
            return when (intent.action) {
                Intent.ACTION_SEND -> if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                Intent.ACTION_VIEW -> intent.data?.takeIf { it.scheme == "content" || it.scheme == "file" }
                else -> null
            }
        }

        /**
         * Display name and a cached copy's path (null when unreadable). Streams to the cache, so a
         * 100+ MB export never sits in memory; stops one byte past the limit so client-core can say
         * it's too large.
         */
        fun copyShared(context: Context, uri: Uri): Pair<String, String?> {
            val name = runCatching {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }
            }.getOrNull() ?: uri.lastPathSegment ?: "activity"
            val target = java.io.File(context.cacheDir, "shared-run-upload")
            val path = runCatching {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use { output ->
                        val chunk = ByteArray(256 * 1024)
                        var total = 0L
                        while (total <= MAX_UPLOAD_BYTES) {
                            val read = input.read(chunk)
                            if (read < 0) break
                            output.write(chunk, 0, read)
                            total += read
                        }
                    }
                    target.absolutePath
                }
            }.getOrNull()
            return name to path
        }
    }
}

class SharedRunImportViewModelFactory(private val raceDay: RaceDayBridge) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = SharedRunImportViewModel(raceDay) as T
}

/** The import sheet. Shown over any screen while a shared file is in flight. */
@Composable
fun SharedRunImportSheet(model: SharedRunImportViewModel) {
    val ui = model.ui ?: return
    var expanded by rememberSaveable { mutableStateOf(false) }
    ToolSheet(title = "Import runs", onDismiss = { if (ui !is SharedRunUi.Importing) model.dismiss() }) {
        Column(
            Modifier.fillMaxWidth().testTag("crewcue.run-share-import").semantics { contentDescription = "Import runs" },
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            when (ui) {
                SharedRunUi.Reading -> Busy(RUN_SHARE_READING)
                SharedRunUi.Importing -> Busy(RUN_SHARE_IMPORTING)
                is SharedRunUi.Message -> {
                    Text(ui.text, style = MaterialTheme.typography.titleMedium)
                    SecondaryButton(
                        if (ui.signedOut) "OK" else "Done",
                        onClick = { model.dismiss() },
                        modifier = Modifier.fillMaxWidth().testTag("crewcue.run-share-import.cancel")
                    )
                }
                is SharedRunUi.Preview -> {
                    Text(ui.title, style = MaterialTheme.typography.titleMedium)
                    val listed = if (model.showsAllRuns) ui.runs else ui.runs.take(ui.firstListedRuns)
                    Column(
                        Modifier.fillMaxWidth().animateContentSize().testTag("crewcue.run-share-import.runs"),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listed.forEach { run -> PreviewRunRow(run, ui.alreadyImportedBadge) }
                    }
                    if (!model.showsAllRuns) {
                        ui.showMoreLabel?.let { label ->
                            SecondaryButton(
                                label,
                                onClick = { model.showAllRuns() },
                                modifier = Modifier.fillMaxWidth().testTag("crewcue.run-share-import.show-more")
                            )
                        }
                    }
                    ui.skippedLine?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    val single = ui.runs.singleOrNull()
                    if (single != null && single.track.size >= 2) RouteSketch(single.track)
                    (ui.unreadableLine ?: if (ui.unreadable.isNotEmpty()) "Unreadable files" else null)?.let { line ->
                        GhostButton(
                            line,
                            onClick = { expanded = !expanded },
                            modifier = Modifier.fillMaxWidth(),
                            spoken = if (expanded) "Hide: $line" else "Show: $line"
                        )
                        if (expanded) {
                            ui.unreadable.forEach {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (ui.canImport) {
                        PrimaryButton(
                            ui.confirmLabel,
                            onClick = { model.confirm() },
                            modifier = Modifier.fillMaxWidth().testTag("crewcue.run-share-import.confirm")
                        )
                        GhostButton(
                            "Cancel",
                            onClick = { model.dismiss() },
                            modifier = Modifier.fillMaxWidth().testTag("crewcue.run-share-import.cancel")
                        )
                    } else {
                        SecondaryButton(
                            "Done",
                            onClick = { model.dismiss() },
                            modifier = Modifier.fillMaxWidth().testTag("crewcue.run-share-import.cancel")
                        )
                    }
                }
            }
        }
    }
}

/**
 * One previewed run: the date as the heading, then Distance, Time and Climb as small labels over
 * bold values. Side by side; stacked at large font scales so nothing clips.
 */
@Composable
private fun PreviewRunRow(run: SharedRun, badge: String) {
    val colors = MaterialTheme.colorScheme
    val stacked = LocalDensity.current.fontScale >= 1.5f
    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, colors.outlineVariant, RoundedCornerShape(12.dp))
            .background(colors.surface, RoundedCornerShape(12.dp))
            .padding(12.dp)
            .clearAndSetSemantics { contentDescription = run.spokenSummary },
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                run.dateLabel,
                style = MaterialTheme.typography.titleSmall,
                color = colors.onSurface,
                modifier = Modifier.weight(1f)
            )
            if (run.alreadyImported) {
                Text(
                    badge,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceVariant,
                    modifier = Modifier
                        .padding(start = 8.dp)
                        .border(1.dp, colors.outline, RoundedCornerShape(50))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                )
            }
        }
        val dim = Modifier.alpha(if (run.alreadyImported) 0.6f else 1f)
        if (stacked) {
            Column(dim, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                run.details.forEach { DetailCell(it, Modifier) }
            }
        } else {
            Row(dim.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                run.details.forEach { DetailCell(it, Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun DetailCell(detail: SharedRunDetail, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            detail.label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1
        )
        Text(
            detail.value,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1
        )
    }
}

@Composable
private fun Busy(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) {}) {
        CircularProgressIndicator(Modifier.padding(end = 12.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

/** The run's route line, fitted with its aspect kept (longitude scaled by latitude). */
@Composable
private fun RouteSketch(track: List<Pair<Double, Double>>) {
    val color = MaterialTheme.colorScheme.primary
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(110.dp)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(12.dp))
            .padding(12.dp)
            .clearAndSetSemantics {}
    ) {
        val points = track.map { (lat, lon) -> (lon * cos(lat * PI / 180)) to -lat }
        val minX = points.minOf { it.first }
        val maxX = points.maxOf { it.first }
        val minY = points.minOf { it.second }
        val maxY = points.maxOf { it.second }
        val spanX = (maxX - minX).coerceAtLeast(1e-9)
        val spanY = (maxY - minY).coerceAtLeast(1e-9)
        val scale = minOf(size.width / spanX, size.height / spanY)
        val offsetX = (size.width - spanX * scale) / 2
        val offsetY = (size.height - spanY * scale) / 2
        val path = Path()
        points.forEachIndexed { index, (x, y) ->
            val point = Offset((offsetX + (x - minX) * scale).toFloat(), (offsetY + (y - minY) * scale).toFloat())
            if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
        }
        drawPath(path, color, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
