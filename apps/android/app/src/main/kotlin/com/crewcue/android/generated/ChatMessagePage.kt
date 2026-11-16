package com.crewcue.android.generated

data class ChatMessagePage(
    val messages: List<ChatMessage>,
    val members: List<ChatRoomMember>,
    val selfUserId: String,
    val olderCursor: String? = null,
    val latestCursor: String
)
