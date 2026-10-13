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

interface StreamRoomClient {
    suspend fun open(context: Context, apiKey: String, userId: String, token: String, channelId: String): List<String>
    suspend fun send(text: String, clientMessageId: String): Boolean
}

object StreamRooms {
    @Volatile
    var client: StreamRoomClient? = null
}
