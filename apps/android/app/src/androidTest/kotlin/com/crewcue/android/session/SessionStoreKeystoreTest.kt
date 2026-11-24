package com.crewcue.android.session

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/** The real Android Keystore key and prefs: the session is sealed on disk and survives a new store. */
@RunWith(AndroidJUnit4::class)
class SessionStoreKeystoreTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val session = StoredSession("keystore-user", "athlete", "keystore-token", "Kay", null, true)

    @After
    fun tearDown() {
        SessionStore(context).clear()
    }

    @Test
    fun sessionIsSealedInPrefsAndRestoredByANewStore() {
        SessionStore(context).clear()
        SessionStore(context).save(session)

        assertEquals(session, SessionStore(context).current())
        val prefsDir = File(context.applicationInfo.dataDir, "shared_prefs")
        val onDisk = prefsDir.listFiles().orEmpty().joinToString("\n") { it.readText() }
        assertFalse(onDisk.contains("keystore-token"))
        assertFalse(File(prefsDir, "${SessionStore.LEGACY_PREFS}.xml").exists())
    }

    @Test
    fun clearLeavesNoSession() {
        SessionStore(context).save(session)
        SessionStore(context).clear()

        assertNull(SessionStore(context).current())
    }
}
