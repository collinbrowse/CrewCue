package com.crewcue.android.session

import android.content.SharedPreferences
import java.io.File
import java.nio.file.Files
import javax.crypto.KeyGenerator
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStoreTest {
    private val ada = StoredSession(
        userId = "ada",
        role = "athlete",
        token = "token-ada-secret",
        displayName = "Ada",
        roomId = "room-1",
        fromAuth0 = true
    )
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val cipher = AesGcmSessionCipher { key }
    private val vault = MemoryPrefs()
    private val legacy = MemoryPrefs()
    private val root: File = Files.createTempDirectory("session-store").toFile()
    private var legacyDeletes = 0

    private fun store(cipher: SessionCipher = this.cipher) =
        SessionStore(vault, legacy, File(root, "crewcue-user"), cipher) { legacyDeletes += 1 }

    private fun vaultText(): String = vault.all.values.joinToString(" ") { it.toString() }

    @Test
    fun savedSessionRoundTripsAcrossInstancesAndIsSealedAtRest() {
        store().save(ada)

        assertEquals(ada, store().current())
        assertFalse(vaultText().contains("token-ada-secret"))
        assertFalse(vaultText().contains("ada"))
    }

    @Test
    fun updateRewritesTheSealedSession() {
        val first = store()
        first.save(ada)
        first.update { it.copy(roomId = null, displayName = "Ada L") }

        assertEquals(ada.copy(roomId = null, displayName = "Ada L"), store().current())
    }

    @Test
    fun legacyPlaintextPrefsMoveIntoTheVaultAndAreDeleted() {
        legacy.edit()
            .putBoolean("present", true)
            .putString(
                "json",
                JSONObject()
                    .put("userId", "ada").put("role", "athlete").put("token", "token-ada-secret")
                    .put("displayName", "Ada").put("roomId", "room-1").put("fromAuth0", true)
                    .toString()
            )
            .commit()

        val migrated = store()

        assertEquals(ada, migrated.current())
        assertTrue(legacy.all.isEmpty())
        assertEquals(1, legacyDeletes)
        assertFalse(vaultText().contains("token-ada-secret"))
        assertEquals(ada, store().current())
    }

    @Test
    fun unreadableLegacyPrefsAreDeletedAndLeaveTheUserSignedOut() {
        legacy.edit().putBoolean("present", true).putString("json", "not json").commit()

        assertNull(store().current())
        assertTrue(legacy.all.isEmpty())
    }

    @Test
    fun clearWipesTheVaultLegacyPrefsAndTheUserFileTree() {
        val signedIn = store()
        signedIn.save(ada)
        val outbox = File(signedIn.storageDir(), "users/ada/outbox.json").apply {
            parentFile?.mkdirs()
            writeText("[]")
        }

        signedIn.clear()

        assertNull(signedIn.current())
        assertNull(store().current())
        assertTrue(vault.all.isEmpty())
        assertFalse(outbox.exists())
        assertFalse(File(root, "crewcue-user").exists())
    }

    @Test
    fun aSessionSealedWithAnotherKeyReadsAsSignedOutAndIsCleared() {
        store().save(ada)
        val otherKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

        assertNull(store(AesGcmSessionCipher { otherKey }).current())
        assertTrue(vault.all.isEmpty())
    }
}

/** SharedPreferences in memory, so the store runs on the JVM without a device. */
private class MemoryPrefs : SharedPreferences {
    private val values = mutableMapOf<String, Any?>()

    override fun getAll(): MutableMap<String, *> = values.toMutableMap()
    override fun getString(key: String, defValue: String?): String? = values[key] as? String ?: defValue
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
    override fun getInt(key: String, defValue: Int): Int = values[key] as? Int ?: defValue
    override fun getLong(key: String, defValue: Long): Long = values[key] as? Long ?: defValue
    override fun getFloat(key: String, defValue: Float): Float = values[key] as? Float ?: defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = values[key] as? Boolean ?: defValue
    override fun contains(key: String): Boolean = values.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val pending = mutableMapOf<String, Any?>()
        private val removed = mutableSetOf<String>()
        private var clear = false

        override fun putString(key: String, value: String?) = apply { pending[key] = value }
        override fun putStringSet(key: String, values: MutableSet<String>?) = apply { pending[key] = values }
        override fun putInt(key: String, value: Int) = apply { pending[key] = value }
        override fun putLong(key: String, value: Long) = apply { pending[key] = value }
        override fun putFloat(key: String, value: Float) = apply { pending[key] = value }
        override fun putBoolean(key: String, value: Boolean) = apply { pending[key] = value }
        override fun remove(key: String) = apply { removed += key }
        override fun clear() = apply { clear = true }
        override fun commit(): Boolean {
            if (clear) values.clear()
            removed.forEach(values::remove)
            values.putAll(pending)
            return true
        }
        override fun apply() {
            commit()
        }
    }
}
