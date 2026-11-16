package com.crewcue.android.generated

data class ChatMessage(
    val id: String,
    val roomId: String,
    val senderUserId: String,
    val clientMessageId: String,
    val text: String,
    val photo: ChatMessagePhoto? = null,
    val createdAt: String
)
