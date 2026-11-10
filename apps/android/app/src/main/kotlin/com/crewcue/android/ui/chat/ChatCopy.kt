package com.crewcue.android.ui.chat

/** Chat status copy comes from client-core `ChatCopy` in each `chatPoll`/`chatSend` answer. */
const val CHAT_ERROR = "Couldn't load chat."
const val CHAT_PHOTO_ERROR = "Couldn't send the photo."

const val PREFS_SUCCESS = "Mentions and check-ins notify."
const val PREFS_EMPTY = "Alerts are off."
const val PREFS_ERROR = "Couldn't save alert settings."
const val PREFS_OFFLINE = "Offline. Alert settings stay on this device."

const val PUSH_SUCCESS = "Push token queued for registration."
const val PUSH_EMPTY = "No push token."
const val PUSH_ERROR = "Push permission was denied."
const val PUSH_OFFLINE = "Offline. Token queued."

/** One transcript row as client-core `ChatThread` built it. */
data class CrewChatMessage(
    val id: String,
    val clientMessageId: String,
    val text: String,
    val author: String,
    val time: String,
    val mine: Boolean,
    val imageUrl: String?,
    /** "sent", "queued" or "failed". */
    val delivery: String
) {
    val deliveryLabel: String
        get() = when (delivery) {
            "queued" -> "Queued"
            "failed" -> "Not sent"
            else -> ""
        }
}
