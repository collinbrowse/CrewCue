package com.crewcue.android.data

import org.json.JSONArray
import org.json.JSONObject

data class PendingWork(
    val message: String,
    val lines: List<String>
)

const val OUTBOX_EMPTY = "Nothing waiting. Everything is uploaded."
const val OUTBOX_OFFLINE = "No signal. These upload once this phone is back online."
const val OUTBOX_REJECTED = "The server turned down a change, so it won't upload."

/** What is still waiting to upload, as plain labels from client-core (`RaceToolsCopy.outboxLabel`). */
fun RuntimeResult.pendingWork(): PendingWork {
    if (this is RuntimeResult.Failure) {
        return PendingWork(if (offline) OUTBOX_OFFLINE else OUTBOX_REJECTED, emptyList())
    }
    val json = (this as RuntimeResult.Success).result
    val operations = json.optJSONArray("operations") ?: JSONArray()
    val lines = buildList {
        for (index in 0 until operations.length()) {
            val row = operations.optJSONObject(index) ?: continue
            if (row.optString("status") != "pending") continue
            add(row.optString("label").ifBlank { row.optString("type") })
        }
    }
    val pending = json.optInt("pending", lines.size)
    val message = when {
        json.optBoolean("rejected") -> OUTBOX_REJECTED
        pending <= 0 -> OUTBOX_EMPTY
        else -> ""
    }
    return PendingWork(message, lines)
}

internal fun JSONArray.stringList(): List<String> = buildList {
    for (index in 0 until length()) {
        val value = optString(index)
        if (value.isNotBlank()) add(value)
    }
}

internal fun JSONObject.stopLines(): Pair<List<String>, List<String>> {
    val formatted = optJSONArray("lines")
    if (formatted != null) {
        val ids = optJSONArray("checkpointIds")?.stringList().orEmpty().ifEmpty { checkpointIdsFromStops() }
        return formatted.stringList() to ids
    }
    val stops = optJSONObject("sheet")?.optJSONArray("stops") ?: optJSONArray("stops") ?: return emptyList<String>() to emptyList()
    val lines = mutableListOf<String>()
    val ids = mutableListOf<String>()
    for (index in 0 until stops.length()) {
        val stop = stops.optJSONObject(index) ?: continue
        val id = stop.optString("checkpointId")
        if (id.isNotBlank()) ids.add(id)
        val line = stop.optString("line").ifBlank {
            listOf(id, stop.opt("elapsedSeconds")?.toString().orEmpty(), stop.optString("clockArrivalAt"))
                .filter { it.isNotBlank() }
                .joinToString("  ")
        }
        if (line.isNotBlank()) lines.add(line)
    }
    return lines to ids
}

private fun JSONObject.checkpointIdsFromStops(): List<String> {
    val stops = optJSONObject("sheet")?.optJSONArray("stops") ?: optJSONArray("stops") ?: return emptyList()
    return buildList {
        for (index in 0 until stops.length()) {
            val id = stops.optJSONObject(index)?.optString("checkpointId").orEmpty()
            if (id.isNotBlank()) add(id)
        }
    }
}
