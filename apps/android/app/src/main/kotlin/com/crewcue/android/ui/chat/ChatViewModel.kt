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
    /** The thread is opening: no messages or status yet. */
    var opening by mutableStateOf(true)
        private set

    private var channelId = "crew-$roomId"
    private var authors = ChatAuthorLabels()
    private var channelOpen = false
    private var parseJob: Job? = null
    private val sessionGate = Mutex()

    fun load(context: Context) {
        opening = true
        viewModelScope.launch {
            try {
                sessionGate.withLock { openSession(context) }
            } finally {
                opening = false
            }
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
        messages = messages + CrewChatMessage(
            id = clientMessageId,
            text = text,
            author = authors.self,
            time = "",
            mine = true,
            reactions = "",
            imageUrl = null
        )
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
        val claimed = (call { raceDay.claimChat(roomId, id) } as? RuntimeResult.Success)
            ?.result?.optBoolean("claimed") == true
        if (!claimed) {
            status = CHAT_ERROR
            return
        }
        status = when (sendClaimed(id, text)) {
            ChatDelivery.Delivered -> if (messages.isEmpty()) CHAT_EMPTY else null
            ChatDelivery.Queued -> if (context.isOnline()) CHAT_ERROR else CHAT_OFFLINE
        }
    }

    /**
     * Sends a claimed message under its stable id, then settles the claim. Client-core decides
     * whether Stream's error ("already exists" after a crash or lost reply) still means delivered.
     */
    private suspend fun sendClaimed(id: String, text: String): ChatDelivery {
        val error = try {
            StreamRooms.client?.send(text, id) ?: "Channel is not open."
        } catch (failure: Throwable) {
            failure.message ?: "Send failed."
        }
        val settled = call { raceDay.settleChat(roomId, id, error) }
        val delivered = settled is RuntimeResult.Success && settled.result.optString("status") == "delivered"
        return if (delivered) ChatDelivery.Delivered else ChatDelivery.Queued
    }

    /** Sends this room's queued messages after the channel opens, including ones a crash left behind. */
    private suspend fun deliverPending(context: Context) {
        val claimed = (call { raceDay.claimPendingChat(roomId) } as? RuntimeResult.Success)
            ?.result?.optJSONArray("messages") ?: return
        val pending = (0 until claimed.length()).mapNotNull { claimed.optJSONObject(it) }
        for ((index, row) in pending.withIndex()) {
            val id = row.optString("id")
            val text = row.optString("text")
            if (id.isBlank()) continue
            if (text.isBlank()) {
                call { raceDay.settleChat(roomId, id, "Empty message.") }
                continue
            }
            if (sendClaimed(id, text) == ChatDelivery.Queued) {
                pending.drop(index + 1).forEach { rest ->
                    call { raceDay.settleChat(roomId, rest.optString("id"), "Delivery stopped.") }
                }
                status = if (context.isOnline()) CHAT_ERROR else CHAT_OFFLINE
                return
            }
            if (messages.none { it.id == id }) {
                messages = messages + CrewChatMessage(
                    id = id,
                    text = text,
                    author = authors.self,
                    time = "",
                    mine = true,
                    reactions = "",
                    imageUrl = null
                )
            }
        }
        if (pending.isNotEmpty()) status = null
    }

    private suspend fun call(block: () -> RuntimeResult): RuntimeResult = try {
        withContext(Dispatchers.IO) { block() }
    } catch (failure: Throwable) {
        RuntimeResult.Failure(failure.message ?: "Request failed", offline = false)
    }

    private suspend fun openChannel(context: Context, json: JSONObject) {
        channelId = json.optString("channelId").ifBlank { "crew-$roomId" }
        authors = authorLabelsIn(json)
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
            withContext(Dispatchers.IO) { client.open(context, apiKey, userId, token, channelId, authors) }
        } catch (_: Throwable) {
            null
        }
        if (opened == null) {
            channelOpen = false
            status = CHAT_ERROR
            return
        }
        channelOpen = true
        messages = opened.messages
        unread = opened.unread
        status = if (opened.messages.isEmpty()) CHAT_EMPTY else null
        deliverPending(context)
    }

    private fun authorLabelsIn(json: JSONObject): ChatAuthorLabels {
        val fallback = ChatAuthorLabels()
        val names = mutableMapOf<String, String>()
        json.optJSONObject("authorNames")?.let { rows ->
            rows.keys().forEach { id -> rows.optString(id).takeIf { it.isNotBlank() }?.let { names[id] = it } }
        }
        return ChatAuthorLabels(
            names = names,
            self = json.optString("selfAuthor").ifBlank { fallback.self },
            unknown = json.optString("unknownAuthor").ifBlank { fallback.unknown }
        )
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

private enum class ChatDelivery { Delivered, Queued }

class ChatViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ChatViewModel(raceDay, roomId) as T
    }
}
