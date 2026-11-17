package com.crewcue.android.session

import android.content.Context
import android.content.SharedPreferences
import java.io.File
import java.util.Base64
import org.json.JSONObject

data class StoredSession(
    val userId: String,
    val role: String,
    val token: String,
    val displayName: String?,
    val roomId: String?,
    val fromAuth0: Boolean
)

/**
 * The signed-in session, sealed with an Android Keystore AES-GCM key before it is written. Only
 * ciphertext reaches SharedPreferences. Builds before the vault kept plaintext JSON in the
 * `crewcue.session` prefs; the first launch moves it into the vault and deletes those prefs.
 */
class SessionStore(
    private val vault: SharedPreferences,
    private val legacy: SharedPreferences,
    private val storageRoot: File,
    private val cipher: SessionCipher,
    private val deleteLegacy: () -> Unit = {}
) {
    constructor(context: Context) : this(
        vault = context.applicationContext.getSharedPreferences(VAULT_PREFS, Context.MODE_PRIVATE),
        legacy = context.applicationContext.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE),
        storageRoot = File(context.applicationContext.filesDir, "crewcue-user"),
        cipher = AesGcmSessionCipher.keystore(),
        deleteLegacy = { context.applicationContext.deleteSharedPreferences(LEGACY_PREFS) }
    )

    private val lock = Any()
    private var cached: StoredSession? = null
    private var loaded = false

    init {
        migrateLegacy()
    }

    fun storageDir(): File {
        storageRoot.mkdirs()
        return storageRoot
    }

    fun current(): StoredSession? {
        synchronized(lock) { return readLocked() }
    }

    private fun readLocked(): StoredSession? {
        if (loaded) return cached
        val sealed = vault.getString(KEY_SEALED, null)
        if (sealed == null) {
            loaded = true
            cached = null
            return null
        }
        val session = runCatching { decode(String(cipher.decrypt(Base64.getDecoder().decode(sealed)), Charsets.UTF_8)) }
            .getOrNull()
        if (session == null) {
            // Unreadable (a lost key, a restore onto another device): the user signs in again.
            clear()
            return null
        }
        cached = session
        loaded = true
        return session
    }

    fun save(session: StoredSession) {
        synchronized(lock) { saveLocked(session) }
    }

    private fun saveLocked(session: StoredSession) {
        val sealed = cipher.encrypt(encode(session).toByteArray(Charsets.UTF_8))
        vault.edit().putString(KEY_SEALED, Base64.getEncoder().encodeToString(sealed)).commit()
        cached = session
        loaded = true
    }

    fun update(transform: (StoredSession) -> StoredSession) {
        synchronized(lock) {
            val current = readLocked() ?: return
            saveLocked(transform(current))
        }
    }

    /** Sign-out and session expiry: the sealed session, any legacy prefs, and every per-user file. */
    fun clear() {
        synchronized(lock) {
            vault.edit().clear().commit()
            cached = null
            loaded = true
            wipeLegacy()
            storageRoot.deleteRecursively()
        }
    }

    private fun migrateLegacy() {
        if (legacy.all.isEmpty()) return
        val plain = legacy.getString(KEY_LEGACY_JSON, null)?.takeIf { legacy.getBoolean(KEY_LEGACY_PRESENT, false) }
        val session = plain?.let(::decode)
        if (session != null) {
            runCatching { saveLocked(session) }
        }
        wipeLegacy()
    }

    private fun wipeLegacy() {
        legacy.edit().clear().commit()
        deleteLegacy()
    }

    private fun encode(session: StoredSession): String {
        return JSONObject()
            .put("userId", session.userId)
            .put("role", session.role)
            .put("token", session.token)
            .put("displayName", session.displayName ?: JSONObject.NULL)
            .put("roomId", session.roomId ?: JSONObject.NULL)
            .put("fromAuth0", session.fromAuth0)
            .toString()
    }

    private fun decode(raw: String): StoredSession? {
        return try {
            val obj = JSONObject(raw)
            StoredSession(
                userId = obj.optString("userId"),
                role = obj.optString("role"),
                token = obj.optString("token"),
                displayName = obj.optStringOrNull("displayName"),
                roomId = obj.optStringOrNull("roomId"),
                fromAuth0 = obj.optBoolean("fromAuth0")
            )
        } catch (_: Exception) {
            null
        }
    }

    // optString turns a JSON null into the text "null", which reads back as a real room id.
    private fun JSONObject.optStringOrNull(key: String): String? =
        if (isNull(key)) null else optString(key).ifBlank { null }

    companion object {
        const val VAULT_PREFS = "crewcue.session.vault"
        const val LEGACY_PREFS = "crewcue.session"
        private const val KEY_SEALED = "sealed"
        private const val KEY_LEGACY_PRESENT = "present"
        private const val KEY_LEGACY_JSON = "json"
    }
}
