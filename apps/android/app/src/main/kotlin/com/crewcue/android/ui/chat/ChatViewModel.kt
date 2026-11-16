package com.crewcue.android.ui.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import java.io.File
import java.text.DateFormat
import java.time.Instant
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Crew chat for one race. The loop runs client-core `chatPoll` (newest page, then long-polls with
 * reconnect backoff); queued messages go out through the outbox on reconnect. Kotlin only renders.
 */
class ChatViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModel() {
    var status by mutableStateOf<String?>(null)
        private set
    var messages by mutableStateOf<List<CrewChatMessage>>(emptyList())
        private set
    var unread by mutableStateOf(0)
        private set
    var draft by mutableStateOf("")
        private set
    var mentionNames by mutableStateOf<List<String>>(emptyList())
        private set
    var sending by mutableStateOf(false)
        private set
    var uploadingPhoto by mutableStateOf(false)
        private set
    var hasOlder by mutableStateOf(false)
        private set
    /** The thread is opening: no messages or status yet. */
    var opening by mutableStateOf(true)
        private set

    private var loop: Job? = null
    private var parseJob: Job? = null
    private var visible = false

    /** Starts the loop once; later calls keep it running. */
    fun load(@Suppress("UNUSED_PARAMETER") context: Context) {
        if (loop?.isActive == true) return
        opening = true
        loop = viewModelScope.launch {
            var fresh = true
            var failures = 0
            while (isActive) {
                val result = withContext(Dispatchers.IO) { raceDay.chatPoll(roomId, fresh, failures) }
                opening = false
                val body = (result as? RuntimeResult.Success)?.result
                if (body == null) {
                    status = CHAT_ERROR
                    failures += 1
                    delay(30_000)
                    continue
                }
                fresh = false
                apply(body)
                failures = body.optInt("failures")
                if (!visible) unread += body.optInt("newFromOthers")
                if (body.optBoolean("stop")) return@launch
                val wait = body.optInt("retryAfterSeconds")
                if (wait > 0) delay(wait * 1000L)
            }
        }
    }

    fun setVisible(value: Boolean) {
        visible = value
        if (value) unread = 0
    }

    fun updateDraft(value: String) {
        draft = value
        parseJob?.cancel()
        if (value.isEmpty()) {
            mentionNames = emptyList()
            return
        }
        parseJob = viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) { raceDay.parseMentions(roomId, value) }
            } catch (_: Throwable) {
                return@launch
            }
            if (draft != value) return@launch
            if (result is RuntimeResult.Success) {
                mentionNames = namesIn(result.result.optJSONArray("tokens"))
            }
        }
    }

    fun send(@Suppress("UNUSED_PARAMETER") context: Context) {
        val text = draft.trim()
        if (text.isEmpty() || sending) return
        draft = ""
        mentionNames = emptyList()
        viewModelScope.launch {
            sending = true
            try {
                when (val result = withContext(Dispatchers.IO) { raceDay.chatSend(roomId, text) }) {
                    is RuntimeResult.Success -> apply(result.result)
                    is RuntimeResult.Failure -> {
                        draft = text
                        status = CHAT_ERROR
                    }
                }
            } finally {
                sending = false
            }
        }
    }

    /** Re-encodes the picked image as a JPEG of at most 2048 px, uploads it, then sends it. */
    fun sendPhoto(context: Context, uri: Uri) {
        if (uploadingPhoto) return
        val caption = draft.trim()
        viewModelScope.launch {
            uploadingPhoto = true
            try {
                val file = withContext(Dispatchers.IO) { preparePhoto(context, uri) }
                if (file == null) {
                    status = CHAT_PHOTO_ERROR
                    return@launch
                }
                val uploaded = withContext(Dispatchers.IO) { raceDay.chatUploadPhoto(roomId, file.absolutePath) }
                file.delete()
                val key = when (uploaded) {
                    is RuntimeResult.Success -> uploaded.result.optText("photoKey")
                    is RuntimeResult.Failure -> {
                        status = if (uploaded.offline) "Photos need a connection." else uploaded.message
                        return@launch
                    }
                }
                draft = ""
                when (val sent = withContext(Dispatchers.IO) { raceDay.chatSend(roomId, caption, key) }) {
                    is RuntimeResult.Success -> apply(sent.result)
                    is RuntimeResult.Failure -> status = CHAT_PHOTO_ERROR
                }
            } finally {
                uploadingPhoto = false
            }
        }
    }

    fun loadOlder() {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.chatOlder(roomId) }
            if (result is RuntimeResult.Success) apply(result.result)
        }
    }

    fun discard(line: CrewChatMessage) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.chatDiscard(roomId, line.clientMessageId) }
            if (result is RuntimeResult.Success) apply(result.result)
        }
    }

    private fun apply(body: JSONObject) {
        body.optJSONArray("rows")?.let { messages = rowsIn(it) }
        if (body.has("status")) status = body.optString("status").ifBlank { null }
        if (body.has("hasOlder")) hasOlder = body.optBoolean("hasOlder")
    }

    private fun rowsIn(rows: JSONArray): List<CrewChatMessage> = (0 until rows.length()).mapNotNull { index ->
        val row = rows.optJSONObject(index) ?: return@mapNotNull null
        CrewChatMessage(
            id = row.optString("id"),
            clientMessageId = row.optString("clientMessageId"),
            text = row.optString("text"),
            author = row.optString("author"),
            time = clock(row.optString("createdAt")),
            mine = row.optBoolean("mine"),
            imageUrl = row.optString("photoUrl").ifBlank { null },
            delivery = row.optString("delivery").ifBlank { "sent" }
        )
    }

    private fun namesIn(tokens: JSONArray?): List<String> {
        if (tokens == null) return emptyList()
        val names = mutableListOf<String>()
        for (index in 0 until tokens.length()) {
            val token = tokens.optJSONObject(index) ?: continue
            if (token.optString("type") != "mention") continue
            val name = token.optText("displayName")
            if (name.isNotBlank()) names += name
        }
        return names
    }

    private fun clock(iso: String): String {
        if (iso.isBlank()) return ""
        return runCatching { DateFormat.getTimeInstance(DateFormat.SHORT).format(Date.from(Instant.parse(iso))) }
            .getOrDefault("")
    }

    private fun preparePhoto(context: Context, uri: Uri): File? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_PHOTO_DIMENSION) sample *= 2
        val decoded = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val longest = maxOf(decoded.width, decoded.height)
        val scaled = if (longest > MAX_PHOTO_DIMENSION) {
            val ratio = MAX_PHOTO_DIMENSION.toFloat() / longest
            Bitmap.createScaledBitmap(decoded, (decoded.width * ratio).toInt(), (decoded.height * ratio).toInt(), true)
        } else {
            decoded
        }
        val file = File.createTempFile("chat-photo", ".jpg", context.cacheDir)
        file.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        file
    }.getOrNull()

    private companion object {
        const val MAX_PHOTO_DIMENSION = 2048
    }
}

class ChatViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ChatViewModel(raceDay, roomId) as T
    }
}
