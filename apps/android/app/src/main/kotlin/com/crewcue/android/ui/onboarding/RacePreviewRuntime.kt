package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** client-core `OnboardingStep.preview`: the replay and its paywall. */
const val PREVIEW_STEP = "preview"

/** Which race a replay is built on (`demoRaceCreate`). */
sealed interface ReplayRoom {
    /** The runner's race, read once from `GET /race-rooms/:roomId`. */
    data class Read(val roomId: String) : ReplayRoom

    /**
     * A room body read earlier (this session's, or the one saved on this phone for offline).
     * [finishEtaAt]: the finish the first replay of this flow started from, so a replay again
     * (Back from the paywall) starts from the same one; without it, the plan's finish is read.
     */
    data class Saved(val roomId: String, val body: JSONObject, val finishEtaAt: String? = null) : ReplayRoom

    /** `DemoRaceFixture`, for the dev route: no API. */
    data object Fixture : ReplayRoom
}

enum class ReplayControl { Play, Pause, Tick, Skip }

/**
 * The client-core runtime ops the race-day replay uses. One seam, so the ViewModel is tested on
 * the JVM with a fake; production goes through [RaceDayBridge]. Every call blocks: run it off Main.
 */
interface RacePreviewRuntime {
    fun create(room: ReplayRoom): RuntimeResult
    fun control(baseUrl: String, control: ReplayControl): RuntimeResult
    fun seek(baseUrl: String, seconds: Double): RuntimeResult
    /** `markOnboardingStep` for the `preview` step ([outcome] `done` or `skipped`), with the shell's race list. */
    fun markPreview(outcome: String, roomId: String): RuntimeResult
}

/**
 * [raceDay] is the app's bridge (the session's token reads the runner's room); [tempDir] the
 * app's cache directory, where client-core puts the replay's own folder; [raceContext] the shell's
 * `myRaces` rows (null while unknown) and active race, sent with the mark.
 */
class BridgeRacePreviewRuntime(
    private val raceDay: RaceDayBridge,
    private val tempDir: String,
    private val raceContext: () -> Pair<JSONArray?, String?>
) : RacePreviewRuntime {
    override fun markPreview(outcome: String, roomId: String): RuntimeResult {
        val (races, active) = raceContext()
        return raceDay.markOnboardingStep(PREVIEW_STEP, outcome, roomId, choice = null, races = races, activeRoomId = active)
    }

    override fun create(room: ReplayRoom): RuntimeResult = when (room) {
        // Start from the plan's finish the teaser shows, planned stops included.
        is ReplayRoom.Read -> raceDay.demoRaceCreate(tempDir, roomId = room.roomId, planFinish = true)
        is ReplayRoom.Saved -> raceDay.demoRaceCreate(
            tempDir,
            roomId = room.roomId,
            room = room.body,
            planFinish = room.finishEtaAt == null,
            finishEtaAt = room.finishEtaAt
        )
        ReplayRoom.Fixture -> raceDay.demoRaceCreate(tempDir, fixture = true)
    }

    override fun control(baseUrl: String, control: ReplayControl): RuntimeResult {
        val replay = raceDay.replay(baseUrl, viewerUserId = "")
        return when (control) {
            ReplayControl.Play -> replay.demoRacePlay()
            ReplayControl.Pause -> replay.demoRacePause()
            ReplayControl.Tick -> replay.demoRaceTick()
            ReplayControl.Skip -> replay.demoRaceSkip()
        }
    }

    override fun seek(baseUrl: String, seconds: Double): RuntimeResult =
        raceDay.replay(baseUrl, viewerUserId = "").demoRaceSeek(seconds)
}

/**
 * The runner's room body (`GET /race-rooms/:roomId` as the server sent it), kept on this phone so
 * the replay plays offline. One race at a time: saving another race's body replaces it.
 */
interface ReplayRoomStore {
    fun load(userId: String, roomId: String): JSONObject?
    fun save(userId: String, roomId: String, room: JSONObject)
    /** Deletes the saved body unless it is [userId]'s [roomId]: the race on the replay step changed. */
    fun keepOnly(userId: String, roomId: String)
    /** The flow finished, or the person signed out. */
    fun clear()
}

/** In the app's no-backup files, outside the per-user storage root, so sign-out clears it explicitly. */
class FileReplayRoomStore(private val directory: File) : ReplayRoomStore {
    private val file get() = File(directory, "room.json")

    @Synchronized
    override fun load(userId: String, roomId: String): JSONObject? {
        val saved = read() ?: return null
        if (saved.optText("userId") != userId || saved.optText("roomId") != roomId) return null
        return saved.optJSONObject("room")
    }

    @Synchronized
    override fun save(userId: String, roomId: String, room: JSONObject) {
        runCatching {
            directory.mkdirs()
            val next = File(directory, "room.json.tmp")
            next.writeText(JSONObject().put("userId", userId).put("roomId", roomId).put("room", room).toString())
            if (!next.renameTo(file)) {
                file.delete()
                next.renameTo(file)
            }
        }
    }

    @Synchronized
    override fun keepOnly(userId: String, roomId: String) {
        val saved = read() ?: return
        if (saved.optText("userId") != userId || saved.optText("roomId") != roomId) file.delete()
    }

    @Synchronized
    override fun clear() {
        directory.deleteRecursively()
    }

    private fun read(): JSONObject? = runCatching { JSONObject(file.readText()) }.getOrNull()
}
