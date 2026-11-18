package com.crewcue.android.ui.onboarding

import java.io.File
import java.nio.file.Files
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplayRoomStoreTest {
    private fun directory(): File = Files.createTempDirectory("race-preview").toFile().resolve("race-preview")

    private val body = JSONObject("""{"room":{"id":"room-1","mapWorkspace":{"layers":[]}},"permissions":{}}""")

    @Test
    fun theSavedBodyIsOnlyEverTheRunnersOwnRace() {
        val store = FileReplayRoomStore(directory())
        assertNull(store.load("ada", "room-1"))
        store.save("ada", "room-1", body)
        assertEquals(body.toString(), store.load("ada", "room-1")?.toString())
        // Another account, or another race, never reads it.
        assertNull(store.load("bo", "room-1"))
        assertNull(store.load("ada", "room-2"))
    }

    @Test
    fun anotherRacesBodyReplacesItOneRaceAtATime() {
        val store = FileReplayRoomStore(directory())
        store.save("ada", "room-1", body)
        store.save("ada", "room-2", JSONObject("""{"room":{"id":"room-2"}}"""))
        assertNull(store.load("ada", "room-1"))
        assertEquals("room-2", store.load("ada", "room-2")?.optJSONObject("room")?.optString("id"))
    }

    @Test
    fun keepOnlyDropsAnyOtherRacesBodyAndClearDropsAll() {
        val folder = directory()
        val store = FileReplayRoomStore(folder)
        store.save("ada", "room-1", body)
        store.keepOnly("ada", "room-1")
        assertEquals(body.toString(), store.load("ada", "room-1")?.toString())
        store.keepOnly("ada", "room-2")
        assertNull(store.load("ada", "room-1"))
        store.save("ada", "room-1", body)
        store.keepOnly("bo", "room-1")
        assertNull(store.load("ada", "room-1"))
        store.save("ada", "room-1", body)
        assertTrue(folder.exists())
        store.clear()
        assertFalse(folder.exists())
        assertNull(store.load("ada", "room-1"))
        // Nothing saved: forgetting changes nothing and fails nothing.
        store.keepOnly("ada", "room-1")
        store.clear()
    }

    @Test
    fun aCorruptFileReadsAsNothingSaved() {
        val folder = directory()
        folder.mkdirs()
        File(folder, "room.json").writeText("{not json")
        assertNull(FileReplayRoomStore(folder).load("ada", "room-1"))
    }
}
