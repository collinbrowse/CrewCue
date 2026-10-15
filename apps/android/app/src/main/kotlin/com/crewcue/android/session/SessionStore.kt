package com.crewcue.android.session

import android.content.Context
import org.json.JSONObject
import java.io.File

data class StoredSession(
    val userId: String,
    val role: String,
    val token: String,
    val displayName: String?,
    val roomId: String?,
    val fromAuth0: Boolean
)

class SessionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val storageRoot = File(context.applicationContext.filesDir, "crewcue-user")

    fun storageDir(): File {
        storageRoot.mkdirs()
        return storageRoot
    }

    fun current(): StoredSession? {
        if (!prefs.getBoolean(KEY_PRESENT, false)) return null
        val raw = prefs.getString(KEY_JSON, null) ?: return null
        return decode(raw) ?: run {
            clear()
            null
        }
    }

    fun save(session: StoredSession) {
        prefs.edit()
            .putBoolean(KEY_PRESENT, true)
            .putString(KEY_JSON, encode(session))
            .apply()
    }

    fun update(transform: (StoredSession) -> StoredSession) {
        val current = current() ?: return
        save(transform(current))
    }

    fun clear() {
        prefs.edit().clear().apply()
        storageRoot.deleteRecursively()
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
                displayName = obj.optString("displayName").ifBlank { null },
                roomId = obj.optString("roomId").ifBlank { null },
                fromAuth0 = obj.optBoolean("fromAuth0")
            )
        } catch (_: Exception) {
            null
        }
    }

    private companion object {
        const val PREFS = "crewcue.session"
        const val KEY_PRESENT = "present"
        const val KEY_JSON = "json"
    }
}
