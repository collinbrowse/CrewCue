package com.crewcue.android.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushTapPayloadTest {
    private val room = "4f3c2a10-8d1e-4c55-9a4b-2f0e6d7c8b91"

    /** Intent extras as `Bundle.get` answers them: only the keys present. */
    private fun extras(vararg pairs: Pair<String, Any?>): (String) -> Any? {
        val map = mapOf(*pairs)
        return { map[it] }
    }

    @Test
    fun readsTheFcmDataKeysFromLaunchExtras() {
        // A system-shown FCM notification: the data keys beside Google's own extras.
        val tap = PushTapPayload.from(
            extras("google.message_id" to "0:1", "type" to "unlock", "roomId" to room, "from" to "123")
        )
        assertEquals(PushTapPayload("unlock", room), tap)
        assertEquals(PushTapPayload("tracking", room), PushTapPayload.from(mapOf("type" to "tracking", "roomId" to room)))
    }

    @Test
    fun keepsValuesAsFoundForClientCoreToDecide() {
        // No type: a chat push sent before kinds existed. client-core reads it as chat.
        assertEquals(PushTapPayload(null, room), PushTapPayload.from(extras("roomId" to room)))
        // A type without a room, or a value that isn't a string, still reaches client-core, which drops it.
        assertEquals(PushTapPayload("unlock", null), PushTapPayload.from(extras("type" to "unlock")))
        assertEquals(PushTapPayload(3, room), PushTapPayload.from(extras("type" to 3, "roomId" to room)))
    }

    @Test
    fun anOrdinaryLaunchIsNoTap() {
        assertNull(PushTapPayload.from(extras()))
        assertNull(PushTapPayload.from(extras("android.intent.extra.STREAM" to "content://x")))
        assertNull(PushTapPayload.from(emptyMap()))
    }
}
