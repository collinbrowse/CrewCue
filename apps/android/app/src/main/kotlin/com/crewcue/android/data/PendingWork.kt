package com.crewcue.android.data

import org.json.JSONArray
import org.json.JSONObject

data class PendingWork(
    val message: String,
    val lines: List<String>
)

fun RuntimeResult.pendingWork(): PendingWork {
    if (this is RuntimeResult.Failure) {
        val message = if (offline) "Network error. Will retry when the app is active." else "Rejected by server policy."
        return PendingWork(message, emptyList())
    }
    val json = (this as RuntimeResult.Success).result
    val operations = json.optJSONArray("operations") ?: JSONArray()
    val lines = buildList {
        for (index in 0 until operations.length()) {
            val row = operations.optJSONObject(index) ?: continue
            val type = row.optString("type")
            val status = row.optString("status")
            if (type.isNotBlank() || status.isNotBlank()) add("$type $status".trim())
        }
    }
    val pending = json.optInt("pending", lines.count { it.endsWith("pending") })
    val safeRetry = (0 until operations.length()).any { index ->
        operations.optJSONObject(index)?.optBoolean("safeRetry") == true
    }
    val message = when {
        json.optBoolean("rejected") -> "Rejected by server policy."
        pending <= 0 -> "Outbox is empty."
        safeRetry -> "Pending $pending. Safe retry true."
        else -> "Pending $pending."
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
