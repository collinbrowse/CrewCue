package com.crewcue.android.ui.athlete

import org.json.JSONObject
import java.io.File

/**
 * The display name athlete setup keeps on this phone until it syncs. It lives outside the
 * per-user storage root, so sign-out clears it ([clear]); the next account never sees it.
 */
class AthleteDraftStore(private val file: File) {
    fun read(): String? {
        if (!file.exists()) return null
        val name = runCatching { JSONObject(file.readText()).optString("displayName") }.getOrNull()?.trim().orEmpty()
        return name.ifBlank { null }
    }

    fun write(name: String) {
        runCatching {
            file.parentFile?.mkdirs()
            file.writeText(JSONObject().put("displayName", name).toString())
        }
    }

    fun clear() {
        runCatching { file.delete() }
    }
}
