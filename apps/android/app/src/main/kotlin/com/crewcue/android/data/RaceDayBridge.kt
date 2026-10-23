package com.crewcue.android.data

import com.crewcue.android.ClientCoreBridge
import com.crewcue.android.logging.AndroidLogger
import com.crewcue.android.session.SessionStore
import org.json.JSONArray
import org.json.JSONObject

sealed interface RuntimeResult {
    data class Success(val result: JSONObject) : RuntimeResult
    data class Failure(val message: String, val offline: Boolean) : RuntimeResult
}

/**
 * Race-day calls go through the Swift runtime JSON bridge. There is no second HTTP stack here.
 */
class RaceDayBridge(
    private val baseUrl: String,
    private val sessionStore: SessionStore,
    private val logger: AndroidLogger
) {
    /**
     * Called (on the calling thread) when an authorized runtime call came back 401. The argument is
     * the token that request carried, so a late reply for an old session can't end a newer one.
     */
    @Volatile
    var onSessionExpired: ((rejectedToken: String) -> Unit)? = null

    fun previewJoin(code: String): RuntimeResult = call("previewJoin") { put("code", code) }

    fun join(code: String): RuntimeResult = call("join") { put("code", code) }

    fun createRoom(name: String, athleteId: String, teamId: String, creatorName: String?): RuntimeResult =
        call("createRoom") {
            put("name", name)
            put("athleteId", athleteId)
            put("teamId", teamId)
            if (!creatorName.isNullOrBlank()) put("creatorName", creatorName)
        }

    fun loadSchedule(roomId: String): RuntimeResult = call("loadSchedule") { put("roomId", roomId) }

    /**
     * Readouts and aid pages placed by [runner], the `latest` object from [latestPing].
     * There is deliberately no device-location input: this phone's GPS never drives race progress.
     */
    fun projectAidSheet(
        sheet: JSONObject?,
        checkpoints: JSONArray,
        runner: JSONObject?,
        selectedIndex: Int,
        follow: Boolean,
        elevation: JSONArray? = null
    ): RuntimeResult = call("projectAidSheet") {
        if (sheet != null) put("sheet", sheet)
        put("checkpoints", checkpoints)
        if (runner != null) put("runner", runner)
        put("selectedIndex", selectedIndex)
        put("follow", follow)
        if (elevation != null && elevation.length() > 0) put("elevation", elevation)
    }

    /** The athlete's latest accepted ping: `{ offline, latest?, refreshSeconds }`. */
    fun latestPing(roomId: String): RuntimeResult = call("latestPing") { put("roomId", roomId) }

    fun loadEstimate(roomId: String): RuntimeResult = call("loadEstimate") { put("roomId", roomId) }

    /**
     * [trigger] is "auto" (athlete history changed), "cold_start" (crew seeds a room with no plan)
     * or "recalculate" (explicit tap). client-core refuses a trigger the role may not use.
     */
    fun computeEstimate(
        roomId: String,
        historyFingerprint: String?,
        usableHistoryCount: Int,
        trigger: String,
        hasPlanOfRecord: Boolean
    ): RuntimeResult =
        call("computeEstimate") {
            put("roomId", roomId)
            put("usableHistoryCount", usableHistoryCount)
            put("trigger", trigger)
            put("hasPlanOfRecord", hasPlanOfRecord)
            if (!historyFingerprint.isNullOrBlank()) put("historyFingerprint", historyFingerprint)
        }

    fun importGpx(
        roomId: String,
        fileName: String,
        gpxXml: String,
        raceStartAt: String,
        plannedPaceSecondsPerKm: Double?
    ): RuntimeResult = call("importGpx") {
        put("roomId", roomId)
        put("fileName", fileName)
        put("gpxXml", gpxXml)
        if (raceStartAt.isNotBlank()) put("raceStartAt", raceStartAt)
        if (plannedPaceSecondsPerKm != null && plannedPaceSecondsPerKm > 0) {
            put("plannedPaceSecondsPerKm", plannedPaceSecondsPerKm)
        }
    }

    fun enqueueCheckIn(roomId: String, checkpointId: String, arrivalAt: String, departureAt: String): RuntimeResult =
        call("enqueueCheckIn") {
            put("roomId", roomId)
            put("checkpointId", checkpointId)
            put("arrivalAt", arrivalAt)
            put("departureAt", departureAt)
        }

    fun flushOutbox(): RuntimeResult = call("flushOutbox")

    /** The user's races and the active one. [preferredRoomId] stays active while the server lists it. */
    fun myRaces(preferredRoomId: String?): RuntimeResult = call("myRaces") {
        if (!preferredRoomId.isNullOrBlank()) put("roomId", preferredRoomId)
    }

    fun loadRoom(roomId: String): RuntimeResult = call("loadRoom") { put("roomId", roomId) }

    fun placeCheckpoint(
        roomId: String,
        id: String,
        title: String,
        latitude: Double,
        longitude: Double
    ): RuntimeResult = call("placeCheckpoint") {
        put("roomId", roomId)
        put("id", id)
        put("title", title)
        put("latitude", latitude)
        put("longitude", longitude)
    }

    fun route(roomId: String, mode: String, checkpointIds: List<String>): RuntimeResult = call("route") {
        put("roomId", roomId)
        put("mode", mode)
        put("checkpointIds", JSONArray(checkpointIds))
    }

    fun enqueuePing(
        roomId: String,
        latitude: Double,
        longitude: Double,
        recordedAt: String,
        horizontalAccuracyMeters: Double?
    ): RuntimeResult = call("enqueuePing") {
        put("roomId", roomId)
        put("latitude", latitude)
        put("longitude", longitude)
        put("recordedAt", recordedAt)
        if (horizontalAccuracyMeters != null && horizontalAccuracyMeters > 0) {
            put("horizontalAccuracyMeters", horizontalAccuracyMeters)
        }
    }

    fun streamToken(roomId: String): RuntimeResult = call("streamToken") { put("roomId", roomId) }

    fun parseMentions(roomId: String, body: String): RuntimeResult = call("parseMentions") {
        put("roomId", roomId)
        put("body", body)
    }

    fun notificationPreference(roomId: String): RuntimeResult =
        call("notificationPreference") { put("roomId", roomId) }

    fun saveNotificationPreference(roomId: String, preference: String): RuntimeResult =
        call("saveNotificationPreference") {
            put("roomId", roomId)
            put("preference", preference)
        }

    fun enqueuePush(deviceId: String, token: String): RuntimeResult = call("enqueuePush") {
        put("deviceId", deviceId)
        put("platform", "android")
        put("token", token)
    }

    fun enqueueChat(roomId: String, text: String, clientMessageId: String): RuntimeResult = call("enqueueChat") {
        put("roomId", roomId)
        put("text", text)
        put("clientMessageId", clientMessageId)
    }

    fun completeOutbox(id: String): RuntimeResult = call("completeOutbox") { put("id", id) }

    /** Claims the message this device is about to send, so redelivery can't send it too. */
    fun claimChat(roomId: String, id: String): RuntimeResult = call("claimChat") {
        put("roomId", roomId)
        put("id", id)
    }

    /** Queued messages for the room that nothing else is sending, including ones a crash left. */
    fun claimPendingChat(roomId: String): RuntimeResult = call("claimPendingChat") { put("roomId", roomId) }

    /** Ends a claim. A null [error] means sent; client-core treats "already exists" as sent too. */
    fun settleChat(roomId: String, id: String, error: String?): RuntimeResult = call("settleChat") {
        put("roomId", roomId)
        put("id", id)
        if (error != null) put("error", error)
    }

    /** Sign-out and session expiry: every account's files under the runtime storage root. */
    fun wipeUserData(): RuntimeResult = call("wipeUserData")

    /** Sign-in: keep only [userId]'s files, so this account never sends another account's queue. */
    fun adoptUser(userId: String): RuntimeResult = call("adoptUser") { put("userId", userId) }

    fun updateDisplayName(roomId: String, memberUserId: String, displayName: String): RuntimeResult =
        call("updateDisplayName") {
            put("roomId", roomId)
            put("memberUserId", memberUserId)
            put("displayName", displayName)
        }

    fun removeMember(roomId: String, memberUserId: String): RuntimeResult = call("removeMember") {
        put("roomId", roomId)
        put("memberUserId", memberUserId)
    }

    fun incidents(roomId: String): RuntimeResult = call("incidents") { put("roomId", roomId) }

    fun createIncident(
        roomId: String,
        category: String,
        severity: String,
        summary: String,
        checkpointId: String?
    ): RuntimeResult = call("createIncident") {
        put("roomId", roomId)
        put("category", category)
        put("severity", severity)
        put("summary", summary)
        if (!checkpointId.isNullOrBlank()) put("checkpointId", checkpointId)
    }

    fun stravaStart(): RuntimeResult = call("stravaStart")

    fun stravaConnection(): RuntimeResult = call("stravaConnection")

    fun stravaDisconnect(): RuntimeResult = call("stravaDisconnect")

    fun listOutbox(): RuntimeResult = call("listOutbox")

    fun exportCrewSheet(roomId: String): RuntimeResult = call("exportCrewSheet") { put("roomId", roomId) }

    fun readCourseSettings(roomId: String): RuntimeResult = call("readCourseSettings") { put("roomId", roomId) }

    fun writeCourseSettings(roomId: String, cutoffNote: String, stoppageSeconds: Double): RuntimeResult = call("writeCourseSettings") {
        put("roomId", roomId)
        put("cutoffNote", cutoffNote)
        put("stoppageSeconds", stoppageSeconds)
    }

    private fun call(op: String, fill: JSONObject.() -> Unit = {}): RuntimeResult {
        val session = sessionStore.current()
        val request = JSONObject()
            .put("op", op)
            .put("baseURL", baseUrl)
            .put("token", session?.token.orEmpty())
            .put("userId", session?.userId.orEmpty())
            .put("role", session?.role.orEmpty())
            .put("storageDir", sessionStore.storageDir().absolutePath)
        request.fill()
        val raw = ClientCoreBridge.runtimeJson(request.toString())
        return parse(op, raw, session?.token.orEmpty())
    }

    private fun parse(op: String, raw: String, token: String): RuntimeResult {
        val obj = try {
            JSONObject(raw)
        } catch (_: Exception) {
            return RuntimeResult.Failure("Request failed", offline = false)
        }
        if (!obj.optBoolean("ok")) {
            if (obj.optBoolean("sessionExpired") && token.isNotEmpty()) {
                onSessionExpired?.invoke(token)
            }
            val message = obj.optString("message").ifBlank { "Request failed" }
            logger.log("$op failed: $message")
            return RuntimeResult.Failure(message, offline = isOffline(message))
        }
        val result = obj.opt("result")
        val json = when (result) {
            is JSONObject -> result
            is JSONArray -> JSONObject().put("items", result)
            is String -> try {
                JSONObject(result)
            } catch (_: Exception) {
                JSONObject().put("value", result)
            }
            else -> JSONObject()
        }
        return RuntimeResult.Success(json)
    }

    private fun isOffline(message: String): Boolean {
        val lower = message.lowercase()
        return lower.contains("offline") ||
            lower.contains("network") ||
            lower.contains("internet") ||
            lower.contains("timed out") ||
            lower.contains("hostname") ||
            lower.contains("unable to resolve")
    }
}
