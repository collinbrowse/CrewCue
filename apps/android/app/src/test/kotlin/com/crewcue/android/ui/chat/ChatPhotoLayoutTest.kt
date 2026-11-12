package com.crewcue.android.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatPhotoLayoutTest {
    @Test
    fun smallPhotosDecodeAtFullSize() {
        assertEquals(1, ChatPhotoLayout.sampleSize(640, 480))
        assertEquals(1, ChatPhotoLayout.sampleSize(1439, 900))
    }

    @Test
    fun largePhotosDecodeAtAPowerOfTwoNoSmallerThanTheCap() {
        assertEquals(2, ChatPhotoLayout.sampleSize(1440, 1080))
        assertEquals(2, ChatPhotoLayout.sampleSize(2048, 1536))
        assertEquals(4, ChatPhotoLayout.sampleSize(4032, 3024))
    }

    @Test
    fun unknownBoundsDecodeAtFullSize() {
        assertEquals(1, ChatPhotoLayout.sampleSize(-1, -1))
    }

    @Test
    fun newestIndexSkipsTheEarlierMessagesRow() {
        assertEquals(4, ChatPhotoLayout.newestIndex(5, hasOlder = false))
        assertEquals(5, ChatPhotoLayout.newestIndex(5, hasOlder = true))
        assertNull(ChatPhotoLayout.newestIndex(0, hasOlder = true))
    }
}
