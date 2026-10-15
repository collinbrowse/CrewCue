package com.crewcue.android.ui.chat

import android.content.Context

const val CHAT_EMPTY = "No messages."
const val CHAT_ERROR = "Couldn't open the channel."
const val CHAT_OFFLINE = "Offline. Message queued on this device."

const val PREFS_SUCCESS = "Mentions and check-ins notify."
const val PREFS_EMPTY = "Alerts are off."
const val PREFS_ERROR = "Couldn't save alert settings."
const val PREFS_OFFLINE = "Offline. Alert settings stay on this device."

const val PUSH_SUCCESS = "Push token queued for registration."
const val PUSH_EMPTY = "No push token."
const val PUSH_ERROR = "Push permission was denied."
const val PUSH_OFFLINE = "Offline. Token queued."

data class CrewChatMessage(
    val id: String,
    val text: String,
    val author: String,
    val time: String,
    val mine: Boolean,
    val reactions: String,
    val imageUrl: String?
)

/**
 * Author labels from client-core `ChatAuthors`, resolved from this room's roster.
 * Stream's user name is global and names are per race, so the Stream name is never shown, nor the id.
 */
data class ChatAuthorLabels(
    val names: Map<String, String> = emptyMap(),
    val self: String = "You",
    val unknown: String = "Crew member"
) {
    fun label(streamUserId: String, mine: Boolean): String = if (mine) self else names[streamUserId] ?: unknown
}

data class CrewChatSnapshot(
    val messages: List<CrewChatMessage>,
    val unread: Int
)

interface StreamRoomClient {
    suspend fun open(
        context: Context,
        apiKey: String,
        userId: String,
        token: String,
        channelId: String,
        authors: ChatAuthorLabels
    ): CrewChatSnapshot
    suspend fun send(text: String, clientMessageId: String): Boolean
}

object StreamRooms {
    @Volatile
    var client: StreamRoomClient? = null
}
