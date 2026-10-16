package com.crewcue.android.ui.chat

import android.content.Context
import io.getstream.chat.android.client.ChatClient
import java.text.DateFormat
import io.getstream.chat.android.client.channel.ChannelClient
import io.getstream.chat.android.models.Message
import io.getstream.chat.android.models.User
import io.getstream.result.Result
import io.getstream.result.call.Call
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object StreamChatBootstrap {
    @JvmStatic
    fun install() {
        StreamRooms.client = StreamAndroidRoomClient()
    }
}

private class StreamAndroidRoomClient : StreamRoomClient {
    private val gate = Mutex()
    private var channel: ChannelClient? = null

    override suspend fun open(
        context: Context,
        apiKey: String,
        userId: String,
        token: String,
        channelId: String,
        authors: ChatAuthorLabels
    ): CrewChatSnapshot = gate.withLock {
        val client = chatClient(context.applicationContext, apiKey)
        client.connectUser(User(id = userId), token).awaitOrNull()
        val room = client.channel("messaging", channelId)
        val watched = room.watch().awaitOrNull() ?: error("watch failed")
        channel = room
        val rows = watched.messages.mapNotNull { message ->
            val image = message.attachments.firstOrNull { it.type == "image" }?.imageUrl
            val reactions = message.reactionScores.entries
                .sortedBy { it.key }
                .joinToString(" ") { "${it.key} ${it.value}" }
            val body = message.text.trim()
            if (body.isEmpty() && image.isNullOrBlank() && reactions.isEmpty()) return@mapNotNull null
            val mine = message.user.id == userId
            CrewChatMessage(
                id = message.id,
                text = body,
                author = authors.label(message.user.id, mine),
                time = message.createdAt?.let { DateFormat.getTimeInstance(DateFormat.SHORT).format(it) }.orEmpty(),
                mine = mine,
                reactions = reactions,
                imageUrl = image
            )
        }
        @Suppress("DEPRECATION")
        val unread = watched.unreadCount
        CrewChatSnapshot(rows, unread)
    }

    override suspend fun send(text: String, clientMessageId: String): Boolean = gate.withLock {
        val room = channel ?: return@withLock false
        room.sendMessage(Message(id = clientMessageId, text = text)).awaitOrNull() != null
    }
}

private fun chatClient(context: Context, apiKey: String): ChatClient {
    if (ChatClient.isInitialized) return ChatClient.instance()
    return ChatClient.Builder(apiKey, context).build()
}

private suspend fun <T : Any> Call<T>.awaitOrNull(): T? = suspendCancellableCoroutine { continuation ->
    enqueue { result ->
        val value = when (result) {
            is Result.Success -> result.value
            is Result.Failure -> null
        }
        if (continuation.isActive) continuation.resume(value)
    }
}
