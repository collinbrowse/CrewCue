package com.crewcue.android.ui.map

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * What the aid sheet projection needs beyond the sheet: the live arrivals client-core already put
 * on the timeline (from the server's live projection) and the runner's path, so client-core can
 * tell a passed aid's real arrival and departure. Android only carries these back; it computes
 * nothing.
 */
object AidRequest {
    /** `{ checkpointId: ISO-8601 }` from the timeline rows' `liveArrivalAt`. */
    fun liveArrivals(rows: List<TimelineRow>): JSONObject {
        val out = JSONObject()
        rows.forEach { row -> row.liveArrivalAt?.takeIf { it.isNotBlank() }?.let { out.put(row.checkpointId, it) } }
        return out
    }

    /** The course line as client-core reads it, `[[longitude, latitude]]`, to check a dropped pin against. */
    fun line(points: List<CoursePoint>): JSONArray {
        val out = JSONArray()
        points.forEach { out.put(JSONArray().put(it.longitude).put(it.latitude)) }
        return out
    }

    /**
     * The page to keep on show after the pages change (a checkpoint added or removed moves them):
     * the one with [checkpointId], else [fallback].
     */
    fun keptIndex(pages: List<AidPage>, checkpointId: String?, fallback: Int): Int =
        checkpointId?.let { id -> pages.indexOfFirst { it.checkpointId == id }.takeIf { it >= 0 } } ?: fallback

    /** `[{ recordedAt, latitude, longitude }]`, oldest first; points without a time are left out. */
    fun track(points: List<CoursePoint>, times: List<Long>): JSONArray {
        val out = JSONArray()
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        points.forEachIndexed { index, point ->
            val at = times.getOrNull(index)?.takeIf { it > 0 } ?: return@forEachIndexed
            out.put(
                JSONObject()
                    .put("recordedAt", format.format(Date(at)))
                    .put("latitude", point.latitude)
                    .put("longitude", point.longitude)
            )
        }
        return out
    }
}
