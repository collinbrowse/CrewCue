package com.crewcue.android.ui.onboarding

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import com.crewcue.android.ui.UserFacingError
import java.time.LocalDate
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Mirrors client-core `FeatureState` (plus submitting) and `UserFacingError` for the step on screen. */
sealed interface SetupStatus {
    data object Ready : SetupStatus
    data object Working : SetupStatus
    data class Failed(val failure: UserFacingError) : SetupStatus
    data class Offline(val failure: UserFacingError) : SetupStatus
}

/** What the setup asks the shell to do. The shell owns the session, the race list and the routes. */
sealed interface RunnerSetupEffect {
    /** `markOnboardingStep` answered this `state`. */
    data class StateChanged(val state: JSONObject) : RunnerSetupEffect
    /** The race was created for this setup: it becomes the active race. */
    data class RoomCreated(val roomId: String) : RunnerSetupEffect
    data class DisplayNameChosen(val name: String) : RunnerSetupEffect
    /** The server now has the course and start time: reload the race list, which moves the flow on. */
    data object RacesChanged : RunnerSetupEffect
    /** 402 `room_unpaid`. */
    data object OpenPaywall : RunnerSetupEffect
}

/** The projection teaser: the finish only, every aid station locked. */
data class TeaserModel(
    val finishAt: String?,
    /** client-core's clock for [finishAt], the same one [summary] writes. */
    val finishClock: String?,
    /** client-core's estimate summary ("Finish 10:42:00  9:42 AM"). */
    val summary: String?,
    val rows: List<TeaserRow>
)

/**
 * Runner phase 1 (clients/behavior/onboarding-runner-setup.md). The server step comes from
 * client-core's onboarding state ([sync]); course and start time follow the server, so the course
 * is held here (and on disk) until the start time uploads both. State survives configuration
 * changes and process death through [SavedStateHandle], and a relaunch through [drafts].
 */
class RunnerSetupViewModel(
    private val runtime: RunnerSetupRuntime,
    private val drafts: RunnerSetupDraftStore,
    private val savedState: SavedStateHandle,
    /** Null while signed out: the account step offers sign-up, nothing is saved. */
    private val userId: String?,
    private val sessionName: String?,
    private val text: OnboardingText,
    /** The device's IANA zone, the start time's default and the comparison's zone. */
    private val deviceZone: String,
    private val today: LocalDate,
    /** The onboarding state on show when the screen opened, so a resume draws its step at once. */
    initialFlow: OnboardingFlow? = null,
    private val io: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {
    private val effectQueue = Channel<RunnerSetupEffect>(Channel.UNLIMITED)
    val effects: Flow<RunnerSetupEffect> = effectQueue.receiveAsFlow()

    /**
     * Draft writes to disk, one at a time and newest last: each keystroke writes, and separate
     * launches could land out of order, leaving an older draft on disk for the next launch.
     */
    private val diskQueue = Channel<RunnerSetupDraft>(Channel.CONFLATED)

    var draft by mutableStateOf(initialDraft())
        private set
    /**
     * The step client-core's onboarding state names: the state the screen opened with, else the
     * one saved before process death, so a resume never draws another step first.
     */
    var serverStep by mutableStateOf(
        initialFlow?.takeIf { it.isRunnerSetup }?.step ?: savedState.get<String>(KEY_SERVER_STEP)
    )
        private set
    var roomId by mutableStateOf(initialFlow?.takeIf { it.isRunnerSetup }?.roomId ?: draft.roomId)
        private set
    var status by mutableStateOf<SetupStatus>(SetupStatus.Ready)
        private set
    /**
     * The course file is on this phone (it uploads with the start time). Assumed from the draft
     * until the disk says otherwise, so a resume on the start time doesn't draw the course first.
     */
    var courseOnDevice by mutableStateOf(draft.courseFileName != null)
        private set
    var preview by mutableStateOf<CoursePreview?>(null)
        private set
    /**
     * client-core's `raceStartAt` for the picked fields, null while they name no instant or while
     * client-core hasn't answered for the latest pick.
     */
    var startInstant by mutableStateOf<String?>(null)
        private set
    /** The shared daylight-saving copy, only for the spring-forward gap. */
    var startProblem by mutableStateOf<String?>(null)
        private set
    /** client-core's labels for the picked day and time. */
    var startDateLabel by mutableStateOf("")
        private set
    var startTimeLabel by mutableStateOf("")
        private set
    /** The start-time picker on show ([DIALOG_DATE], [DIALOG_TIME], [DIALOG_ZONE]), kept across a fold. */
    var dialog by mutableStateOf(savedState.get<String>(KEY_DIALOG))
        private set
    /** What the runner typed to filter the zone list. */
    var zoneFilter by mutableStateOf(savedState.get<String>(KEY_ZONE_FILTER).orEmpty())
        private set
    var historyMessage by mutableStateOf(savedState.get<String>(KEY_HISTORY_MESSAGE))
        private set
    var comparison by mutableStateOf(savedState.get<String>(KEY_COMPARISON))
        private set
    var teaser by mutableStateOf<TeaserModel?>(null)
        private set

    private var startTicket = 0
    private val gate = Mutex()

    init {
        if (userId != null) {
            viewModelScope.launch(io) {
                for (next in diskQueue) drafts.save(userId, next)
            }
            viewModelScope.launch {
                courseOnDevice = draft.courseFileName != null && withContext(io) { drafts.readCourse(userId) } != null
            }
        }
        validateStart()
    }

    /** The step on screen: client-core's, except that a previewed course moves on to the start time locally. */
    val step: String?
        get() = visibleStep(serverStep, draft, courseOnDevice, roomId)

    val busy: Boolean get() = status is SetupStatus.Working

    val start: RaceStartFields get() = draft.start ?: defaultStart()

    /** A new onboarding state from the shell. */
    fun sync(flow: OnboardingFlow) {
        if (!flow.isRunnerSetup) return
        val room = flow.roomId
        val saved = draft.roomId
        if (room != null && saved != null && room != saved) {
            // The draft was for another race: keep only the name.
            writeDraft(RunnerSetupDraft(roomId = room, displayName = draft.displayName))
            courseOnDevice = false
            preview = null
            teaser = null
            keepComparison(null)
        } else if (room != null && saved == null) {
            writeDraft(draft.copy(roomId = room))
        }
        roomId = room ?: draft.roomId
        val changed = serverStep != flow.step
        serverStep = flow.step
        savedState[KEY_SERVER_STEP] = flow.step
        // A failure belongs to the step it happened on.
        if (changed && status !is SetupStatus.Working) status = SetupStatus.Ready
        if (step != SetupSteps.START_TIME && dialog != null) closeDialog()
        when (step) {
            SetupSteps.COURSE, SetupSteps.START_TIME -> previewSavedCourse()
            SetupSteps.HISTORY -> {
                rememberFinishWithoutHistory()
                // After a relaunch the line comes back from the saved finish instants.
                if (draft.historyImported && comparison == null) viewModelScope.launch { refreshComparison() }
            }
            SetupSteps.TEASER -> if (teaser == null) loadTeaser()
        }
    }

    // MARK: account

    fun updateName(value: String) {
        writeDraft(draft.copy(displayName = value))
    }

    fun saveAccount() {
        val name = draft.displayName.trim()
        if (name.isEmpty() || userId == null || busy) return
        work {
            effectQueue.trySend(RunnerSetupEffect.DisplayNameChosen(name))
            val result = withContext(io) { runtime.markStep(SetupSteps.ACCOUNT, "done", null) }
            onState(result)
        }
    }

    // MARK: course

    /** A picked course file; [gpxXml] is null when it couldn't be read. Creates the race on first use. */
    fun chooseCourse(fileName: String, gpxXml: String?, online: Boolean) {
        val user = userId ?: return
        if (busy) return
        if (gpxXml.isNullOrBlank()) {
            status = failed(text.setupError)
            return
        }
        work {
            preview = null
            writeDraft(draft.copy(courseFileName = fileName, courseConfirmed = false, plannedPaceSecondsPerKm = null, uploadedStartAt = null))
            val written = withContext(io) {
                drafts.save(user, draft)
                drafts.writeCourse(user, gpxXml)
            }
            courseOnDevice = written
            if (!online) {
                status = offline()
                return@work
            }
            val room = roomId ?: createRoom(user, fileName) ?: return@work
            previewCourse(room, fileName, gpxXml)
        }
    }

    /** The runner saw the course on the map; the start time comes next. */
    fun confirmCourse() {
        if (preview == null || busy) return
        writeDraft(draft.copy(courseConfirmed = true))
        validateStart()
    }

    fun backToCourse() {
        if (busy) return
        writeDraft(draft.copy(courseConfirmed = false))
    }

    /** Retries the preview after an offline or failed attempt. */
    fun retryCourse(online: Boolean) {
        if (busy) return
        if (!online) {
            status = offline()
            return
        }
        status = SetupStatus.Ready
        previewSavedCourse(force = true)
    }

    // MARK: start time

    fun updateStart(fields: RaceStartFields) {
        writeDraft(draft.copy(start = fields))
        // The old instant must not upload for the new fields: Continue waits for client-core.
        startInstant = null
        startProblem = null
        validateStart()
    }

    fun openDialog(id: String) {
        if (id == DIALOG_ZONE) updateZoneFilter("")
        dialog = id
        savedState[KEY_DIALOG] = id
    }

    fun closeDialog() {
        dialog = null
        savedState[KEY_DIALOG] = null
    }

    fun updateZoneFilter(value: String) {
        zoneFilter = value
        savedState[KEY_ZONE_FILTER] = value
    }

    /** Uploads the course with the start time (the existing import path), then estimates the finish. */
    fun saveStart(online: Boolean) {
        val user = userId ?: return
        val room = roomId ?: return
        val fileName = draft.courseFileName ?: return
        val startAt = startInstant ?: return
        if (busy) return
        if (startAt == draft.uploadedStartAt) {
            // Already on the server; the race list just hasn't moved the flow on yet.
            effectQueue.trySend(RunnerSetupEffect.RacesChanged)
            return
        }
        if (!online) {
            status = offline()
            return
        }
        work {
            val xml = withContext(io) { drafts.readCourse(user) }
            if (xml == null) {
                courseOnDevice = false
                writeDraft(draft.copy(courseConfirmed = false))
                status = failed(text.setupError)
                return@work
            }
            val result = withContext(io) { runtime.importCourse(room, fileName, xml, startAt, draft.plannedPaceSecondsPerKm) }
            when (result) {
                is RuntimeResult.Failure -> fail(result, courseSave = true)
                is RuntimeResult.Success -> when (result.result.optText("status")) {
                    "saved" -> {
                        writeDraft(draft.copy(uploadedStartAt = startAt))
                        estimateFinish(room)?.let { writeDraft(draft.copy(withoutHistoryFinishAt = it)) }
                        effectQueue.trySend(RunnerSetupEffect.RacesChanged)
                    }
                    // Lost the connection mid-upload: the outbox sends it later. The step stays.
                    "queued" -> status = offline()
                    else -> status = failed(text.setupError)
                }
            }
        }
    }

    // MARK: history

    /** [contentBase64] is null when the file couldn't be read. */
    fun importHistory(fileName: String, contentBase64: String?, online: Boolean) {
        if (busy) return
        if (contentBase64 == null) {
            status = failed(text.setupError)
            return
        }
        if (!online) {
            status = offline()
            return
        }
        work {
            val result = withContext(io) { runtime.importActivity(fileName, contentBase64) }
            when (result) {
                is RuntimeResult.Failure -> fail(result)
                is RuntimeResult.Success -> {
                    // client-core's message for every status, server refusals included.
                    keepHistoryMessage(result.result.optText("message").ifBlank { null })
                    if (result.result.optText("status") !in setOf("saved", "duplicate")) return@work
                    writeDraft(draft.copy(historyImported = true))
                    val room = roomId ?: return@work
                    val finish = estimateFinish(room) ?: return@work
                    writeDraft(draft.copy(withHistoryFinishAt = finish))
                    refreshComparison()
                }
            }
        }
    }

    fun finishHistory() = markHistory("done")

    fun skipHistory() = markHistory("skipped")

    /**
     * A history file went in (saved or already there), so Continue (done) replaces Skip. Kept in
     * the draft, so a relaunch on the history step doesn't offer Skip again.
     */
    val historyImported: Boolean get() = draft.historyImported

    private fun markHistory(outcome: String) {
        if (busy) return
        work { onState(withContext(io) { runtime.markStep(SetupSteps.HISTORY, outcome, null) }) }
    }

    // MARK: projection teaser

    private fun loadTeaser() {
        val room = roomId ?: return
        work {
            if (teaser != null) return@work
            var estimate = withContext(io) { runtime.loadEstimate(room) }
            val loaded = (estimate as? RuntimeResult.Success)?.result
            if (loaded != null && !loaded.optBoolean("hasEstimate") && !loaded.optBoolean("offline")) {
                estimate = withContext(io) { computeWithRetry(room) }
            }
            val plan = when (estimate) {
                is RuntimeResult.Failure -> {
                    fail(estimate)
                    return@work
                }
                is RuntimeResult.Success -> estimate.result
            }
            val roomResult = withContext(io) { runtime.loadRoom(room) }
            val course = (roomResult as? RuntimeResult.Success)?.result?.let(CoursePreview::from)
            if (course != null && !course.isEmpty) preview = course
            val schedule = (withContext(io) { runtime.loadSchedule(room) } as? RuntimeResult.Success)?.result
            val checkpoints = (course ?: preview)?.checkpointJson() ?: JSONArray()
            val projected = withContext(io) {
                runtime.timeline(schedule?.optJSONObject("sheet"), checkpoints, (course ?: preview)?.elevationJson())
            }
            val rows = parseTimeline((projected as? RuntimeResult.Success)?.result?.optJSONArray("timeline"))
            val titles = (course ?: preview)?.checkpoints?.associate { it.id to it.title }.orEmpty()
            val finishRow = rows.lastOrNull { it.isFinish && it.clockArrivalAt != null }
            teaser = TeaserModel(
                finishAt = finishRow?.clockArrivalAt ?: plan.optText("expectedFinishAt").ifBlank { null },
                finishClock = finishRow?.clockLabel ?: plan.optText("finishClock").ifBlank { null },
                summary = plan.optText("summary").ifBlank { null },
                rows = TeaserRow.build(rows, TeaserRow.lockedIds(schedule), titles)
            )
            if (plan.optBoolean("offline")) status = offline()
        }
    }

    fun finishTeaser() {
        val room = roomId ?: return
        if (busy) return
        work {
            val result = withContext(io) { runtime.markStep(SetupSteps.TEASER, "done", room) }
            if (result is RuntimeResult.Success) {
                // Setup is over: the course is on the server and the progress is marked.
                withContext(io) { drafts.clear() }
            }
            onState(result)
        }
    }

    /** Try again after a failure, for the step on screen. */
    fun retry(online: Boolean) {
        if (busy) return
        when (step) {
            SetupSteps.COURSE -> retryCourse(online)
            SetupSteps.TEASER -> {
                if (!online) {
                    status = offline()
                    return
                }
                status = SetupStatus.Ready
                teaser = null
                loadTeaser()
            }
            else -> status = SetupStatus.Ready
        }
    }

    // MARK: internals

    private suspend fun createRoom(user: String, fileName: String): String? {
        // The race is named after the course file until the runner renames it.
        val name = fileName.substringBeforeLast('.').trim().ifBlank { fileName }
        val creator = draft.displayName.trim().ifBlank { sessionName?.trim().orEmpty() }.ifBlank { null }
        val result = withContext(io) { runtime.createRoom(name, user, creator) }
        return when (result) {
            is RuntimeResult.Failure -> {
                fail(result)
                null
            }
            is RuntimeResult.Success -> {
                val id = result.result.optText("id").ifBlank { null }
                if (id == null) {
                    status = failed(text.setupError)
                } else {
                    roomId = id
                    writeDraft(draft.copy(roomId = id))
                    effectQueue.trySend(RunnerSetupEffect.RoomCreated(id))
                }
                id
            }
        }
    }

    private suspend fun previewCourse(room: String, fileName: String, gpxXml: String) {
        val result = withContext(io) { runtime.gpxPreview(room, fileName, gpxXml) }
        when (result) {
            is RuntimeResult.Failure -> {
                // The saved race is gone or not this user's: the next try creates a new one.
                if ((result.status == 403 || result.status == 404) && draft.roomId == room) {
                    roomId = null
                    writeDraft(draft.copy(roomId = null))
                }
                fail(result, courseSave = true)
            }
            is RuntimeResult.Success -> {
                val parsed = CoursePreview.from(result.result)
                if (result.result.optText("status") != "previewed" || parsed.isEmpty) {
                    status = failed(text.setupError)
                    return
                }
                preview = parsed
                writeDraft(draft.copy(plannedPaceSecondsPerKm = parsed.plannedPaceSecondsPerKm))
            }
        }
    }

    /** After process death or a relaunch the course is on disk but not drawn: preview it again. */
    private fun previewSavedCourse(force: Boolean = false) {
        val user = userId ?: return
        val fileName = draft.courseFileName ?: return
        // After a failure the runner retries; don't spend the preview budget on every new state.
        if (preview != null || (status is SetupStatus.Failed && !force)) return
        // Only a tap (Try again) creates the race for a file picked offline.
        if (roomId == null && !force) return
        work {
            if (preview != null) return@work
            val xml = withContext(io) { drafts.readCourse(user) }
            courseOnDevice = xml != null
            if (xml == null) return@work
            val room = roomId ?: createRoom(user, fileName) ?: return@work
            previewCourse(room, fileName, xml)
        }
    }

    /** The plan before any history, read once the history step opens without one. */
    private fun rememberFinishWithoutHistory() {
        val room = roomId ?: return
        if (draft.withoutHistoryFinishAt != null || busy) return
        viewModelScope.launch {
            val loaded = (withContext(io) { runtime.loadEstimate(room) } as? RuntimeResult.Success)?.result ?: return@launch
            val finish = loaded.optText("expectedFinishAt").ifBlank { null } ?: return@launch
            if (draft.withoutHistoryFinishAt == null) writeDraft(draft.copy(withoutHistoryFinishAt = finish))
        }
    }

    private suspend fun refreshComparison() {
        val with = draft.withHistoryFinishAt
        val without = draft.withoutHistoryFinishAt
        if (with == null || without == null) {
            keepComparison(null)
            return
        }
        val result = withContext(io) { runtime.historyComparison(with, without, deviceZone) }
        // Null text: history changed nothing the runner can see, so the line is hidden.
        keepComparison((result as? RuntimeResult.Success)?.result?.optText("text")?.ifBlank { null })
    }

    /**
     * Computes and attaches a plan after a step saved, returning its finish instant. Only an unpaid
     * race's 402 shows (the paywall); any other failure, the estimator limit included, leaves the
     * saved step as is, and the teaser computes again and says so there.
     */
    private suspend fun estimateFinish(room: String): String? {
        val result = withContext(io) { computeWithRetry(room) }
        return when (result) {
            is RuntimeResult.Failure -> {
                if (result.status == 402 && result.code == ROOM_UNPAID) fail(result)
                null
            }
            is RuntimeResult.Success -> result.result.optText("expectedFinishAt").ifBlank { null }
        }
    }

    /** 400 `course_mismatch`: the course changed under the estimate. Recompute and attach again, silently. */
    private fun computeWithRetry(room: String): RuntimeResult {
        var result = runtime.computeEstimate(room)
        var retries = 0
        while (result is RuntimeResult.Failure && result.code == COURSE_MISMATCH && retries < MISMATCH_RETRIES) {
            retries++
            result = runtime.computeEstimate(room)
        }
        return result
    }

    private fun validateStart() {
        val fields = start
        val ticket = ++startTicket
        viewModelScope.launch {
            val result = withContext(io) { runtime.raceStartInput(fields) }
            if (ticket != startTicket) return@launch
            val json = (result as? RuntimeResult.Success)?.result
            startInstant = json?.optText("raceStartAt")?.ifBlank { null }
            json?.optText("dateLabel")?.let { startDateLabel = it }
            json?.optText("timeLabel")?.let { startTimeLabel = it }
            startProblem = if (json?.optText("problem") == "daylightSavingGap") {
                json.optText("message").ifBlank { text.startTimeDstGap }
            } else {
                null
            }
        }
    }

    private fun onState(result: RuntimeResult) {
        when (result) {
            is RuntimeResult.Failure -> fail(result)
            is RuntimeResult.Success -> result.result.optJSONObject("state")?.let {
                effectQueue.trySend(RunnerSetupEffect.StateChanged(it))
            }
        }
    }

    /**
     * [courseSave]: the request saved or previewed the course (`gpx-preview`, `PUT course`), the
     * only kind whose 429 has its own copy, as on iOS. Any other 429 (the estimator's) is a plain
     * failure: no shared copy names that limit yet.
     */
    private fun fail(result: RuntimeResult.Failure, courseSave: Boolean = false) {
        status = when {
            result.status == 402 && result.code == ROOM_UNPAID -> {
                effectQueue.trySend(RunnerSetupEffect.OpenPaywall)
                SetupStatus.Ready
            }
            result.offline -> offline()
            result.status == 429 && courseSave -> failed(text.courseSaveLimit, code = "rate_limited")
            else -> failed(text.setupError)
        }
    }

    private fun failed(message: String, code: String = "error") =
        SetupStatus.Failed(UserFacingError(code, message, retryable = true))

    private fun offline() = SetupStatus.Offline(UserFacingError("offline", text.setupOffline, retryable = true))

    /**
     * Runs requests one at a time, in order. Taps check [busy] first, so a second tap while one
     * runs does nothing; loads a new state asks for wait their turn instead of being dropped.
     */
    private fun work(block: suspend () -> Unit) {
        viewModelScope.launch {
            gate.withLock {
                status = SetupStatus.Working
                try {
                    block()
                } finally {
                    if (status is SetupStatus.Working) status = SetupStatus.Ready
                }
            }
        }
    }

    private fun writeDraft(next: RunnerSetupDraft) {
        draft = next
        savedState[KEY_DRAFT] = next.toJson()
        if (userId != null) diskQueue.trySend(next)
    }

    private fun keepHistoryMessage(value: String?) {
        historyMessage = value
        savedState[KEY_HISTORY_MESSAGE] = value
    }

    private fun keepComparison(value: String?) {
        comparison = value
        savedState[KEY_COMPARISON] = value
    }

    private fun initialDraft(): RunnerSetupDraft {
        val saved = RunnerSetupDraft.from(savedState.get<String>(KEY_DRAFT))
            ?: userId?.let { drafts.load(it) }
            ?: RunnerSetupDraft()
        val name = saved.displayName.ifBlank { sessionName?.trim().orEmpty() }
        return saved.copy(displayName = name)
    }

    /** Tomorrow at 06:00 in the device's zone, until the runner picks. */
    private fun defaultStart(): RaceStartFields {
        val day = today.plusDays(1)
        return RaceStartFields(day.year, day.monthValue, day.dayOfMonth, DEFAULT_START_HOUR, 0, deviceZone)
    }

    companion object {
        const val COURSE_MISMATCH = "course_mismatch"
        const val ROOM_UNPAID = "room_unpaid"
        const val MISMATCH_RETRIES = 2
        const val DEFAULT_START_HOUR = 6
        private const val KEY_DRAFT = "runner-setup.draft"
        private const val KEY_HISTORY_MESSAGE = "runner-setup.history-message"
        private const val KEY_COMPARISON = "runner-setup.comparison"
        private const val KEY_SERVER_STEP = "runner-setup.server-step"
        private const val KEY_DIALOG = "runner-setup.dialog"
        private const val KEY_ZONE_FILTER = "runner-setup.zone-filter"
        const val DIALOG_DATE = "date"
        const val DIALOG_TIME = "time"
        const val DIALOG_ZONE = "zone"

        /** Course and start time follow the server: a previewed course moves on to the start time on this phone. */
        fun visibleStep(serverStep: String?, draft: RunnerSetupDraft, courseOnDevice: Boolean, roomId: String?): String? =
            when (serverStep) {
                SetupSteps.COURSE, SetupSteps.START_TIME ->
                    if (draft.courseConfirmed && courseOnDevice && roomId != null) SetupSteps.START_TIME else SetupSteps.COURSE
                else -> serverStep
            }
    }
}
