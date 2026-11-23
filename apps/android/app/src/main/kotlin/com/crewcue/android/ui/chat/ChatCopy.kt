package com.crewcue.android.ui.chat

/** Chat status copy comes from client-core `ChatCopy` in each `chatPoll`/`chatSend` answer. */
const val CHAT_ERROR = "Couldn't load chat."
const val CHAT_PHOTO_ERROR = "Couldn't send the photo."

const val PREFS_ALL = "Every crew chat message in this race notifies you."
const val PREFS_SUCCESS = "Only messages that @mention you, and check-ins."
const val PREFS_EMPTY = "Crew chat won't notify you. Check-ins still do."
const val PREFS_ERROR = "Couldn't save alert settings."
const val PREFS_OFFLINE = "Offline. Alert settings stay on this device."

/** Registration reached the server: the row shows "On" and no status line. */
const val PUSH_SUCCESS = ""
const val PUSH_EMPTY = "This phone couldn't set up alerts. Try again."
const val PUSH_ERROR = "Notifications are off for CrewCue. Turn them on in Android settings."
const val PUSH_FAILED = "This phone couldn't set up alerts. Try again."
const val PUSH_OFFLINE = "Offline. Alerts start once this phone is back online."
const val PUSH_HINT_OFF = "Check-ins, ETA changes and crew chat, even with the app closed."
const val PUSH_HINT_ON = "On. Check-ins, ETA changes and crew chat reach you, even with the app closed."

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
