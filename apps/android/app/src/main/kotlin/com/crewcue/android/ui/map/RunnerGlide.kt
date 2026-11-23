package com.crewcue.android.ui.map

import java.time.Instant
import java.time.format.DateTimeParseException
import org.json.JSONObject

/**
 * One frame of the onboarding replay's runner dot: client-core `demoRaceRunner`
 * (`DemoRacePlayer.runnerPosition`), on the course line. Only the replay has one; on the race Map
 * the dot is always the runner's latest ping.
 */
data class RunnerGlideFrame(
    val latitude: Double,
    val longitude: Double,
    /** Path points recorded at or before this (epoch ms) are behind the dot: the trail stops at the dot. */
    val atMillis: Long,
    /** Path points recorded at or before this were behind the dot when its glide began. */
    val fromMillis: Long
) {
    companion object {
        /** Null for the empty answer before the first ping, or a shape it can't read. */
        fun from(json: JSONObject?): RunnerGlideFrame? {
            json ?: return null
            val latitude = json.optDouble("latitude", Double.NaN).takeIf { it.isFinite() } ?: return null
            val longitude = json.optDouble("longitude", Double.NaN).takeIf { it.isFinite() } ?: return null
            val at = epochMillis(json.optString("recordedAt")) ?: return null
            val from = epochMillis(json.optString("fromRecordedAt")) ?: return null
            return RunnerGlideFrame(latitude, longitude, at, from)
        }
    }
}

/** An ISO 8601 instant (`2026-08-15T12:30:00.000Z`) in epoch ms, or null. */
fun epochMillis(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return try {
        Instant.parse(iso).toEpochMilli()
    } catch (_: DateTimeParseException) {
        null
    }
}

/**
 * Where the gliding dot is on the runner's path, which the Map draws in two pieces: the [settled]
 * points that were behind the dot when its glide began (one shape, redrawn only when that changes)
 * and the stretch from there through the points [reached] since, to the [dot] (redrawn each frame).
 * A path read that hasn't caught up with the glide yet keeps the dot on the path's last point.
 */
data class GlideLayout(val settled: Int, val reached: Int, val dot: CoursePoint) {
    /** The path from the last settled point through the points reached since, to the dot. At least two points. */
    fun stretch(track: List<CoursePoint>): List<CoursePoint> {
        val end = minOf(reached, track.size)
        val start = (settled - 1).coerceIn(0, end)
        val points = track.subList(start, end).toMutableList()
        points += dot
        if (points.size < 2) points += dot
        return points
    }

    companion object {
        /** [times]: each [track] point's `recordedAt` in epoch ms, oldest first. */
        fun of(frame: RunnerGlideFrame, track: List<CoursePoint>, times: List<Long>): GlideLayout {
            val caughtUp = (times.lastOrNull() ?: Long.MIN_VALUE) >= frame.atMillis
            val reached = if (caughtUp) countAtOrBefore(times, frame.atMillis) else times.size
            // A frame's `from` is never after its `at`, so this is never past the dot.
            val settled = minOf(countAtOrBefore(times, frame.fromMillis), reached)
            val dot = if (caughtUp) CoursePoint(frame.latitude, frame.longitude) else track.lastOrNull() ?: CoursePoint(frame.latitude, frame.longitude)
            return GlideLayout(settled, reached, dot)
        }

        /** How many of [times] (oldest first) are at or before [moment]. */
        fun countAtOrBefore(times: List<Long>, moment: Long): Int {
            var low = 0
            var high = times.size
            while (low < high) {
                val middle = (low + high) ushr 1
                if (times[middle] <= moment) low = middle + 1 else high = middle
            }
            return low
        }
    }
}
