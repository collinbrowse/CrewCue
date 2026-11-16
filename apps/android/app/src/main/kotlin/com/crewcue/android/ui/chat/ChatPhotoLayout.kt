package com.crewcue.android.ui.chat

/**
 * Pure layout rules for chat photos and the transcript, kept out of Compose so they are unit tested.
 *
 * A photo always takes the same frame, loaded or not, so the list never changes height after it
 * scrolls to the newest message.
 */
object ChatPhotoLayout {
    const val FRAME_WIDTH_DP = 220
    const val FRAME_HEIGHT_DP = 165

    /** Longest edge to decode at: about 3x the frame, enough for any phone density. */
    const val DECODE_MAX_PX = 720

    /** Power-of-two `inSampleSize` that brings the longest edge down to at most [maxPx]. */
    fun sampleSize(width: Int, height: Int, maxPx: Int = DECODE_MAX_PX): Int {
        val longest = maxOf(width, height)
        if (longest <= 0 || maxPx <= 0) return 1
        var sample = 1
        while (longest / (sample * 2) >= maxPx) sample *= 2
        return sample
    }

    /** Lazy-list index of the newest message, counting the "Earlier messages" row above it. */
    fun newestIndex(messageCount: Int, hasOlder: Boolean): Int? {
        if (messageCount <= 0) return null
        return messageCount - 1 + if (hasOlder) 1 else 0
    }
}
