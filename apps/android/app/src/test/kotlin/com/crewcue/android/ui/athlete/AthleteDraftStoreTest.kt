package com.crewcue.android.ui.athlete

import java.io.File
import kotlin.io.path.createTempDirectory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class AthleteDraftStoreTest {
    @Test
    fun signOutClearsTheDraftSoTheNextAccountNeverSeesIt() {
        val dir = createTempDirectory("athlete-draft").toFile()
        val file = File(dir, "crewcue/athlete-draft.json")
        val store = AthleteDraftStore(file)
        assertNull(store.read())
        store.write("Ada Lovelace")
        assertEquals("Ada Lovelace", store.read())
        store.clear()
        assertNull(store.read())
        assertFalse(file.exists())
        // Clearing twice (a second sign-out) is fine.
        store.clear()
        dir.deleteRecursively()
    }

    @Test
    fun aBlankOrBrokenDraftReadsAsNone() {
        val dir = createTempDirectory("athlete-draft").toFile()
        val file = File(dir, "athlete-draft.json")
        val store = AthleteDraftStore(file)
        store.write("   ")
        assertNull(store.read())
        file.writeText("not json")
        assertNull(store.read())
        dir.deleteRecursively()
    }
}
