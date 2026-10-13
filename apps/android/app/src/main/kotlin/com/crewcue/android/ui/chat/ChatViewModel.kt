package com.crewcue.android.ui.chat

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.map.isOnline
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class ChatViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModel() {
    var channelId by mutableStateOf("crew-$roomId")
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var messages by mutableStateOf<List<String>>(emptyList())
        private set
    var draft by mutableStateOf("")
        private set
    var mentionNames by mutableStateOf<List<String>>(emptyList())
        private set
    var sending by mutableStateOf(false)
        private set

    private var channelOpen = false
    private var parseJob: Job? = null
    private val sessionGate = Mutex()

    fun load(context: Context) {
        viewModelScope.launch {
            sessionGate.withLock { openSession(context) }
        }
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
                mentionNames = namesIn(result.result)
            }
        }
    }

    fun send(context: Context) {
        val text = draft
        if (text.isBlank() || sending) return
        val clientMessageId = "chat-$roomId-${UUID.randomUUID()}"
        viewModelScope.launch {
            sending = true
            try {
                sessionGate.withLock { deliver(context, text, clientMessageId) }
            } finally {
                sending = false
            }
        }
    }

    private suspend fun openSession(context: Context) {
        val result = try {
            withContext(Dispatchers.IO) { raceDay.streamToken(roomId) }
        } catch (_: Throwable) {
            status = CHAT_ERROR
            return
        }
        when (result) {
            is RuntimeResult.Failure -> status = if (result.offline) status else CHAT_ERROR
            is RuntimeResult.Success -> openChannel(context, result.result)
        }
    }

    private suspend fun deliver(context: Context, text: String, clientMessageId: String) {
        val queued = try {
            withContext(Dispatchers.IO) { raceDay.enqueueChat(roomId, text, clientMessageId) }
        } catch (_: Throwable) {
            status = if (context.isOnline()) CHAT_ERROR else CHAT_OFFLINE
            return
        }
        val queuedBody = when (queued) {
            is RuntimeResult.Failure -> {
                status = if (queued.offline || !context.isOnline()) CHAT_OFFLINE else CHAT_ERROR
                return
            }
            is RuntimeResult.Success -> queued.result
        }
        val id = queuedBody.optString("id").ifBlank { clientMessageId }
        messages = messages + text
        draft = ""
        mentionNames = emptyList()
        if (!context.isOnline()) {
            status = CHAT_OFFLINE
            return
        }
        if (!channelOpen) {
            status = CHAT_ERROR
            return
        }
        val accepted = try {
            StreamRooms.client?.send(text, clientMessageId) == true
        } catch (_: Throwable) {
            false
        }
        if (!accepted) {
            status = CHAT_ERROR
            return
        }
        val completed = try {
            withContext(Dispatchers.IO) { raceDay.completeOutbox(id) }
        } catch (_: Throwable) {
            status = CHAT_ERROR
            return
        }
        status = when (completed) {
            is RuntimeResult.Failure -> if (completed.offline) CHAT_OFFLINE else CHAT_ERROR
            is RuntimeResult.Success -> if (messages.isEmpty()) CHAT_EMPTY else null
        }
    }

    private suspend fun openChannel(context: Context, json: JSONObject) {
        channelId = json.optString("channelId").ifBlank { "crew-$roomId" }
        if (json.optBoolean("offline")) return
        val token = json.optString("token")
        val apiKey = json.optString("streamApiKey")
        val userId = json.optString("streamUserId")
        val client = StreamRooms.client
        if (client == null || token.isBlank() || apiKey.isBlank() || userId.isBlank()) {
            channelOpen = false
            status = CHAT_ERROR
            return
        }
        val opened = try {
            withContext(Dispatchers.IO) { client.open(context, apiKey, userId, token, channelId) }
        } catch (_: Throwable) {
            null
        }
        if (opened == null) {
            channelOpen = false
            status = CHAT_ERROR
            return
        }
        channelOpen = true
        messages = opened
        status = if (opened.isEmpty()) CHAT_EMPTY else null
    }

    private fun namesIn(json: JSONObject): List<String> {
        val tokens = json.optJSONArray("tokens") ?: return emptyList()
        return namesIn(tokens)
    }

    private fun namesIn(tokens: JSONArray): List<String> {
        val names = mutableListOf<String>()
        for (index in 0 until tokens.length()) {
            val token = tokens.optJSONObject(index) ?: continue
            if (token.optString("type") != "mention") continue
            val name = token.optString("displayName")
            if (name.isNotBlank()) names += name
        }
        return names
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
