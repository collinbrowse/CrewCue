package com.crewcue.android.data

import com.crewcue.android.ClientCoreBridge
import com.crewcue.android.logging.AndroidLogger
import com.crewcue.android.session.SessionStore
import org.json.JSONArray
import org.json.JSONObject

sealed interface RuntimeResult {
    data class Success(val result: JSONObject) : RuntimeResult
    /**
     * [crewLimit]: a join or invite refused because the room's crew tier is full (409 `crew_limit_reached`).
     * [status] is the HTTP status (0 when the failure was not an HTTP answer) and [code] the body's
     * code, for example 402 `room_unpaid` or 400 `course_mismatch`.
     */
    data class Failure(
        val message: String,
        val offline: Boolean,
        val crewLimit: Boolean = false,
        val status: Int = 0,
        val code: String? = null
    ) : RuntimeResult
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
        elevation: JSONArray? = null,
        live: JSONObject? = null
    ): RuntimeResult = call("projectAidSheet") {
        if (sheet != null) put("sheet", sheet)
        put("checkpoints", checkpoints)
        if (runner != null) put("runner", runner)
        if (live != null) put("live", live)
        put("selectedIndex", selectedIndex)
        put("follow", follow)
        if (elevation != null && elevation.length() > 0) put("elevation", elevation)
    }

    /** The athlete's latest accepted ping: `{ offline, latest?, refreshSeconds }`. */
    fun latestPing(roomId: String): RuntimeResult = call("latestPing") { put("roomId", roomId) }

    /** New path points after [after] (the previous result's `cursor`): `{ offline, points, cursor? }`. */
    fun pingTrack(roomId: String, after: String?): RuntimeResult = call("pingTrack") {
        put("roomId", roomId)
        if (!after.isNullOrBlank()) put("after", after)
    }

    /** The server's live projection: `{ offline, live?, finishCrossed? }`. Pass `live` back to [projectAidSheet]. */
    fun liveProjection(roomId: String): RuntimeResult = call("liveProjection") { put("roomId", roomId) }

    fun trackingSettings(): RuntimeResult = call("trackingSettings")

    fun setTrackingSettings(intervalSeconds: Int): RuntimeResult =
        call("setTrackingSettings") { put("intervalSeconds", intervalSeconds) }

    /** `{ active, roomId?, startedAt? }`, saved so tracking resumes after a restart. */
    fun trackingSession(): RuntimeResult = call("trackingSession")

    fun startTrackingSession(roomId: String): RuntimeResult = call("startTrackingSession") { put("roomId", roomId) }

    fun stopTrackingSession(): RuntimeResult = call("stopTrackingSession")

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

    /**
     * One step of the chat loop (client-core `ChatSync`): the newest page when [fresh], otherwise a
     * long-poll of up to [waitSeconds]. Blocks; call it off the main thread.
     */
    fun chatPoll(roomId: String, fresh: Boolean, failures: Int, waitSeconds: Int = 25): RuntimeResult = call("chatPoll") {
        put("roomId", roomId)
        put("fresh", fresh)
        put("failures", failures)
        put("wait", waitSeconds)
    }

    /** Queues the message under a stable client id and sends it now when online. */
    fun chatSend(roomId: String, text: String, photoKey: String? = null): RuntimeResult = call("chatSend") {
        put("roomId", roomId)
        put("text", text)
        if (photoKey != null) put("photoKey", photoKey)
    }

    /** Uploads the prepared image file at [path]; returns its `photoKey`. Needs a connection. */
    fun chatUploadPhoto(roomId: String, path: String, contentType: String = "image/jpeg"): RuntimeResult =
        call("chatUploadPhoto") {
            put("roomId", roomId)
            put("path", path)
            put("contentType", contentType)
        }

    fun chatOlder(roomId: String): RuntimeResult = call("chatOlder") { put("roomId", roomId) }

    /** Drops a message the server refused from the outbox. */
    fun chatDiscard(roomId: String, clientMessageId: String): RuntimeResult = call("chatDiscard") {
        put("roomId", roomId)
        put("clientMessageId", clientMessageId)
    }

    fun completeOutbox(id: String): RuntimeResult = call("completeOutbox") { put("id", id) }

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

    /** #652: an exported .gpx/.fit/.tcx, base64. Result carries status and a user-facing message. */
    fun importActivityFile(fileName: String, contentBase64: String): RuntimeResult = call("importActivityFile") {
        put("fileName", fileName)
        put("contentBase64", contentBase64)
    }

    /** Pacing history for display: items[].summary, newest first. */
    fun activityHistoryItems(): RuntimeResult = call("activityHistoryItems")

    fun stravaStart(): RuntimeResult = call("stravaStart")

    fun stravaConnection(): RuntimeResult = call("stravaConnection")

    fun stravaDisconnect(): RuntimeResult = call("stravaDisconnect")

    /** `DELETE /me` (#560). `result.deleted` is true only when the server confirmed. */
    fun deleteAccount(): RuntimeResult = call("deleteAccount")

    /** Shared Delete account copy from client-core. */
    fun accountDeletionCopy(): RuntimeResult = call("accountDeletionCopy")

    fun listOutbox(): RuntimeResult = call("listOutbox")

    fun exportCrewSheet(roomId: String): RuntimeResult = call("exportCrewSheet") { put("roomId", roomId) }

    /** #250 Pace edit draft: rows, projected stops, and timeline for the typed minutes. Pure; no network. */
    fun stopPlanDraft(
        checkpoints: JSONArray,
        sheet: JSONObject?,
        progressMeters: Double,
        minutes: Map<String, String>,
        stepCheckpointId: String? = null,
        stepMinutes: Int = 0
    ): RuntimeResult = call("stopPlanDraft") {
        put("checkpoints", checkpoints)
        if (sheet != null) put("sheet", sheet)
        put("progressMeters", progressMeters)
        put("minutes", JSONObject(minutes))
        if (stepCheckpointId != null) {
            put("step", JSONObject().put("checkpointId", stepCheckpointId).put("deltaMinutes", stepMinutes))
        }
    }

    /** Saves the changed planned stops. The result always carries `saved` and shared `message` copy. */
    fun updatePlannedStops(roomId: String, edits: JSONArray): RuntimeResult = call("updatePlannedStops") {
        put("roomId", roomId)
        put("stops", edits)
    }

    fun readCourseSettings(roomId: String): RuntimeResult = call("readCourseSettings") { put("roomId", roomId) }

    fun writeCourseSettings(roomId: String, cutoffNote: String, stoppageSeconds: Double): RuntimeResult = call("writeCourseSettings") {
        put("roomId", roomId)
        put("cutoffNote", cutoffNote)
        put("stoppageSeconds", stoppageSeconds)
    }

    /** `{roomId,isPaid,isUnlimited,crewCount,crewLimit?,hasCrewSeat,offers[],summary}`. Not entitlement-gated. */
    fun billing(roomId: String): RuntimeResult = call("billing") { put("roomId", roomId) }

    /**
     * After a store purchase: maps [store] ("purchased" | "cancelled" | "failed") and polls the room's
     * billing until the server unlocks it. Result `{phase, message, code?, billing?}`.
     */
    fun completePurchase(
        roomId: String,
        product: String,
        store: String,
        message: String? = null,
        offline: Boolean = false,
        pollAttempts: Int? = null
    ): RuntimeResult = call("completePurchase") {
        put("roomId", roomId)
        put("product", product)
        put("store", store)
        if (message != null) put("message", message)
        if (offline) put("offline", true)
        if (pollAttempts != null) put("pollAttempts", pollAttempts)
    }

    /** Debug builds: the fake store (POST /billing/dev-purchase) plus the same poll as [completePurchase]. */
    fun fakePurchase(roomId: String, product: String, webhookDelaySeconds: Double, pollAttempts: Int? = null): RuntimeResult =
        call("fakePurchase") {
            put("roomId", roomId)
            put("product", product)
            if (webhookDelaySeconds > 0) put("webhookDelaySeconds", webhookDelaySeconds)
            if (pollAttempts != null) put("pollAttempts", pollAttempts)
        }

    /**
     * client-core decides the onboarding flow. [races] is the `races` array from [myRaces], or null
     * while it hasn't answered (the state then follows the last saved list, or is `loading`).
     */
    fun readOnboarding(races: JSONArray?, activeRoomId: String?): RuntimeResult = call("readOnboarding") {
        onboardingContext(races, activeRoomId)
    }

    /** Records a step ([step] + [outcome] + [roomId]) or the chooser's [choice]; answers `progress` and `state`. */
    fun markOnboardingStep(
        step: String?,
        outcome: String?,
        roomId: String?,
        choice: String?,
        races: JSONArray?,
        activeRoomId: String?
    ): RuntimeResult = call("markOnboardingStep") {
        onboardingContext(races, activeRoomId)
        if (!step.isNullOrBlank()) put("step", step)
        if (!outcome.isNullOrBlank()) put("outcome", outcome)
        if (!roomId.isNullOrBlank()) put("roomId", roomId)
        if (!choice.isNullOrBlank()) put("choice", choice)
    }

    /** Forgets the user's onboarding progress (the signed-out guest's when signed out). */
    fun resetOnboarding(): RuntimeResult = call("resetOnboarding")

    /** Shared onboarding strings: chooser, step titles and explanations, errors and control `labels`. */
    fun onboardingCopy(): RuntimeResult = call("onboardingCopy")

    /** `{text}`: "Finish 9:42 AM instead of 10:15 AM", or null when the line should be hidden. */
    fun onboardingHistoryComparison(withHistoryFinishAt: String, withoutHistoryFinishAt: String, timeZone: String): RuntimeResult =
        call("onboardingHistoryComparison") {
            put("withHistoryFinishAt", withHistoryFinishAt)
            put("withoutHistoryFinishAt", withoutHistoryFinishAt)
            put("timeZone", timeZone)
        }

    /** client-core `RaceStartInput`: the typed fields in [timeZone] → `raceStartAt` or a `problem`. */
    fun raceStartInput(year: Int, month: Int, day: Int, hour: Int, minute: Int, timeZone: String): RuntimeResult =
        call("raceStartInput") {
            put("year", year)
            put("month", month)
            put("day", day)
            put("hour", hour)
            put("minute", minute)
            put("timeZone", timeZone)
        }

    /** The server's parse of a GPX before it is saved: `line`, `checkpoints`, `elevation`, `plannedPaceSecondsPerKm`. */
    fun gpxPreview(roomId: String, fileName: String, gpxXml: String): RuntimeResult = call("gpxPreview") {
        put("roomId", roomId)
        put("fileName", fileName)
        put("gpxXml", gpxXml)
    }

    /**
     * client-core `RaceAccess` for the active race: [billing] is the last billing read for it
     * (`paid`, `unpaid`, or null while unknown) and [onboarding] the state `readOnboarding`
     * answered. Answers `unpaid`, `loadsRace`, `samplesLocation`, `gatesActions`, `lockedReason`.
     */
    fun raceAccess(roomId: String, role: String?, billing: String?, onboarding: JSONObject?): RuntimeResult = call("raceAccess") {
        put("roomId", roomId)
        if (!role.isNullOrBlank()) put("role", role)
        if (!billing.isNullOrBlank()) put("billing", billing)
        if (onboarding != null) put("onboarding", onboarding)
    }

    /** Removes demo replay folders a killed process left in [tempDir] (the app's cache directory). */
    fun demoRaceCleanup(tempDir: String): RuntimeResult = call("demoRaceCleanup") { put("tempDir", tempDir) }

    private fun JSONObject.onboardingContext(races: JSONArray?, activeRoomId: String?) {
        if (races != null) put("races", races)
        if (!activeRoomId.isNullOrBlank()) put("activeRoomId", activeRoomId)
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
            return RuntimeResult.Failure(
                message,
                offline = obj.optBoolean("offline") || isOffline(message),
                crewLimit = obj.optBoolean("crewLimit"),
                status = obj.optInt("status", 0),
                code = obj.optText("code").ifBlank { null }
            )
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
        // client-core sends server text for HTTP errors, so an NSURLErrorDomain message is a transport
        // failure. On Android, Foundation reports a refused or unreachable host as code -1.
        if (lower.contains("nsurlerrordomain")) return !lower.contains("code=-999")
        return lower.contains("offline") ||
            lower.contains("network") ||
            lower.contains("internet") ||
            lower.contains("timed out") ||
            lower.contains("hostname") ||
            lower.contains("unable to resolve")
    }
}
