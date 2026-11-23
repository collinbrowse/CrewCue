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
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
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
    /** Back on the first step, before a race exists: the chooser again (on the dev link, the app's own launch). */
    data object LeaveSetup : RunnerSetupEffect
}

/**
 * The projection teaser: the finish only, every aid station locked. One finish throughout: the
 * schedule's finish row, which the estimate payload's `finishAt` and summary also read.
 */
data class TeaserModel(
    val finishAt: String?,
    /** client-core's clock for [finishAt], the same one [summary] writes. */
    val finishClock: String?,
    /** client-core's estimate summary: the explanation, then "Finish 10:42:00 · 9:42 AM". */
    val summary: String?,
    val rows: List<TeaserRow>
)

/**
 * A file picked while a course is already there (this phone's, or the race's), kept aside until
 * its preview comes back: one the server can't read leaves that course in place, with Try again
 * and Cancel. Held in memory only, so process death drops it and the course before it stays.
 */
data class PendingCourse(
    val fileName: String,
    val xml: String,
    val fingerprint: String,
    /** The course the race already saved from this phone, picked again: it isn't saved twice. */
    val saved: Boolean
)

/**
 * Runner phase 1 (clients/behavior/onboarding-runner-setup.md). The server step comes from
 * client-core's onboarding state ([sync]); course and start time follow the server, so the course
 * is held here (and on disk) until the start time uploads both. State survives configuration
 * changes and process death through [SavedStateHandle], and a relaunch through [drafts].
 *
 * Back opens the step before the one on screen with everything entered kept. The step setup has
 * reached is the frontier; a step opened with Back (or by a relaunch) is reviewed, and its
 * Continue opens the next step until it meets the frontier again, saving only what changed. Every
 * one of those decisions is client-core `RunnerSetupSteps` ([SetupDecisions]).
 */
class RunnerSetupViewModel(
    private val runtime: RunnerSetupRuntime,
    private val drafts: RunnerSetupDraftStore,
    private val savedState: SavedStateHandle,
    /** Null while signed out: the account step offers sign-up, nothing is saved. */
    private val userId: String?,
    private val sessionName: String?,
    private val text: OnboardingText,
    /** The device's IANA zone, the start time's default. */
    private val deviceZone: String,
    private val today: LocalDate,
    /** The onboarding state on show when the screen opened, so a resume draws its step at once. */
    initialFlow: OnboardingFlow? = null,
    private val io: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {
    private val effectQueue = Channel<RunnerSetupEffect>(Channel.UNLIMITED)
    val effects: Flow<RunnerSetupEffect> = effectQueue.receiveAsFlow()

    private val decisions = SetupDecisions(runtime)

    /**
     * Draft writes to disk, one at a time and newest last: each keystroke writes, and separate
     * launches could land out of order, leaving an older draft on disk for the next launch.
     */
    private val diskQueue = Channel<RunnerSetupDraft>(Channel.CONFLATED)

    /** A new launch, not a restore after process death: the relaunch check may reopen a step. */
    private val freshLaunch = !savedState.contains(KEY_DRAFT)

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

    // MARK: steps

    /** A step behind the frontier the runner went Back to (or a relaunch reopened). Null on the frontier. */
    var reviewing by mutableStateOf(savedState.get<String>(KEY_REVIEWING))
        private set
    /**
     * Ahead of client-core's step only after a save the race list hasn't answered for yet (or a
     * course kept as the race saved it). The frontier is the further of the two.
     */
    private var localStep by mutableStateOf(savedState.get<String>(KEY_LOCAL_STEP))
    /** The step the runner changed something on since it opened. Back, Continue and a relaunch forget it. */
    private var editedStep by mutableStateOf(savedState.get<String>(KEY_EDITED_STEP))

    // MARK: course

    /** A file picked while a course is there, waiting for its preview (see [PendingCourse]). */
    var pendingCourse by mutableStateOf<PendingCourse?>(null)
        private set
    /** A course file is being read and previewed (`POST …/course/gpx-preview`). */
    var previewingCourse by mutableStateOf(false)
        private set
    /**
     * A picked file is being read, from the pick until its map is ready: the loader says "Reading
     * your course…" only then, not while a preview restored after a relaunch draws.
     */
    var readingCourse by mutableStateOf(false)
        private set
    /** The preview's map drew its first full frame, or the wait for it ran out ([MAP_WAIT_MS]). */
    var courseMapReady by mutableStateOf(false)
        private set
    private var mapWait: Job? = null

    /** The race list's name for this setup's race (never another race's). */
    private var listedRaceName by mutableStateOf<String?>(null)
    /** The race list says the race has a course. */
    private var raceListHasCourse by mutableStateOf(false)

    /**
     * The relaunch check hasn't reopened a step yet and the runner hasn't moved since this launch.
     * It runs on the first state and again on each fresh race list, so a stale list can't use it up.
     */
    private var resumeWatching = userId != null && freshLaunch
    private var resumeChecked = false
    private var seenRacesVersion: Int? = null

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

    /** The step client-core's state names, with a previewed course moved on to the start time on this phone. */
    private val serverFrontier: String?
        get() = visibleStep(serverStep, draft, courseOnDevice, roomId)

    /** The furthest step setup has reached: client-core's, or a save ahead of it. */
    val frontier: String?
        get() {
            val server = serverFrontier ?: return null
            val local = localStep ?: return server
            return decisions.moveOn(server, null, local).frontier
        }

    private fun navigation(): SetupDecisions.Navigation? {
        val frontier = frontier ?: return null
        return decisions.navigation(frontier, reviewing, raceExists = roomId != null)
    }

    /** The step on screen: the frontier, or a step behind it the runner went Back to. */
    val step: String?
        get() = navigation()?.shown

    /** The step on screen is behind the frontier: opened with Back, or by a relaunch. */
    val isReviewing: Boolean
        get() = navigation()?.reviewing != null

    /** Back shows on every step after the first, and on the first only before a race exists. */
    val showsBack: Boolean
        get() = navigation()?.canGoBack == true

    val busy: Boolean get() = status is SetupStatus.Working

    val start: RaceStartFields get() = draft.start ?: defaultStart()

    /**
     * A new onboarding state from the shell. [races] is the race list it was read with (`myRaces`
     * rows; only setup's own race's row is read) and [racesVersion] counts fresh race lists, so a
     * relaunch's check runs again on each one.
     */
    fun sync(flow: OnboardingFlow, races: JSONArray? = null, racesVersion: Int = 0) {
        if (!flow.isRunnerSetup) return
        val room = flow.roomId
        val saved = draft.roomId
        if (room != null && saved != null && room != saved) {
            // The draft was for another race: keep only the runner's name.
            writeDraft(RunnerSetupDraft(roomId = room, displayName = draft.displayName))
            courseOnDevice = false
            showPreview(null)
            teaser = null
            keepComparison(null)
            pendingCourse = null
            listedRaceName = null
            raceListHasCourse = false
            keepReviewing(null)
            keepLocalStep(null)
            keepEditedStep(null)
        } else if (room != null && saved == null) {
            // Made elsewhere (or before this phone saved it): the race list has its name.
            writeDraft(draft.copy(roomId = room, raceName = null))
        }
        roomId = room ?: draft.roomId
        followRace(races)
        val changed = serverStep != flow.step
        serverStep = flow.step
        savedState[KEY_SERVER_STEP] = flow.step
        // The race list caught up with a save made here: the frontier is client-core's again.
        val server = serverFrontier
        val local = localStep
        if (server != null && local != null && decisions.moveOn(server, null, local).frontier == server) keepLocalStep(null)
        val fresh = seenRacesVersion != null && seenRacesVersion != racesVersion
        seenRacesVersion = racesVersion
        if (resumeWatching && (fresh || !resumeChecked)) {
            resumeChecked = true
            if (resumeIfNeeded()) resumeWatching = false
        }
        // A failure belongs to the step it happened on.
        if (changed && status !is SetupStatus.Working) status = SetupStatus.Ready
        onStepShown()
    }

    /** Back: the step before this one, with everything entered kept; from the first step, the chooser. */
    fun goBack() {
        if (busy) return
        val navigation = navigation() ?: return
        if (!navigation.canGoBack) return
        status = SetupStatus.Ready
        // A picked file that couldn't be read is dropped; the course before it stays.
        pendingCourse = null
        leaveStep()
        val previous = navigation.previous
        if (previous == null) {
            effectQueue.trySend(RunnerSetupEffect.LeaveSetup)
            return
        }
        keepReviewing(previous)
        onStepShown()
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
            if (onState(result)) moveOn(SetupSteps.COURSE)
        }
    }

    // MARK: course

    /** The race's name as typed, until the race exists (there's no rename after that). */
    fun updateRaceName(value: String) {
        if (roomId != null) return
        writeDraft(draft.copy(raceName = value.ifEmpty { null }))
    }

    /** The race exists: its name is read-only, because the API has no rename. */
    val raceNameLocked: Boolean get() = roomId != null

    /** The name shown once the race exists: as typed on this phone, else the race list's. */
    val shownRaceName: String?
        get() = draft.raceName?.trim()?.ifEmpty { null } ?: listedRaceName

    /** The course file creates the race, so the race needs its name first. */
    val canChooseCourse: Boolean
        get() = !busy && (roomId != null || !draft.raceName.isNullOrBlank())

    /** The file named on the course step: the one being read, else the one this phone holds, else the race's. */
    val shownCourseFileName: String?
        get() = pendingCourse?.fileName ?: draft.courseFileName ?: preview?.courseFileName

    /** The race already has a course: the list says so, or this phone saved it. */
    val courseSavedOnRace: Boolean
        get() {
            val room = roomId
            if (room == null || draft.roomId != room) return raceListHasCourse
            val savedHere = draft.savedCourseFingerprint != null || (draft.courseUnsaved == false && draft.savedRaceStartAt != null)
            return raceListHasCourse || savedHere
        }

    /**
     * The saved course's file name when this phone knows it without holding the file (the teaser
     * read it from the room), for "Course saved".
     */
    val savedCourseFileName: String?
        get() = preview?.courseFileName?.trim()?.ifEmpty { null }

    /** What the course step's main button does (client-core `RunnerSetupSteps.courseContinue`). */
    val courseAction: CourseContinue
        get() = decisions.courseContinue(
            holdsPickedFile = draft.courseFileName != null && courseOnDevice,
            previewed = preview != null,
            courseSavedOnRace = courseSavedOnRace
        )

    val canContinueCourse: Boolean
        get() = pendingCourse == null && courseAction != CourseContinue.ChooseFile && canChooseCourse

    /** A file picked after Back couldn't be read: Cancel keeps the course from before. */
    val canCancelCourse: Boolean
        get() = pendingCourse != null && !busy && (status is SetupStatus.Failed || status is SetupStatus.Offline)

    /**
     * The preview failed (offline, a file the server can't read, no race name): the step offers
     * Try again for the same file rather than Continue.
     */
    val courseNeedsRetry: Boolean
        get() = !busy && (status is SetupStatus.Failed || status is SetupStatus.Offline) &&
            (pendingCourse != null || (draft.courseFileName != null && preview == null))

    /** The loader sits where the preview goes: while a file is read, and until its map is ready. */
    val courseLoading: Boolean
        get() = previewingCourse || (preview?.isEmpty == false && !courseMapReady)

    /**
     * The loader's caption, "Reading your course…", only while a picked file is read; a preview
     * restored after a relaunch waits with none (spoken "Loading").
     */
    val courseLoadingCaption: String?
        get() = if (courseLoading && readingCourse) text.label("readingCourse").ifBlank { null } else null

    /** "Course saved" and Continue: this phone doesn't hold the file and the race saved a course. */
    val showsCourseSaved: Boolean
        get() = courseAction == CourseContinue.KeepSavedCourse && pendingCourse == null

    /**
     * A picked course file; [gpxXml] is null when it couldn't be read. The first file is kept on
     * this phone at once and creates the race; one picked while a course is there replaces it only
     * once it previews. The same file picked again changes nothing, and the course the race saved,
     * picked again, isn't saved twice.
     */
    fun chooseCourse(fileName: String, gpxXml: String?, online: Boolean) {
        val user = userId ?: return
        if (busy) return
        if (gpxXml.isNullOrBlank()) {
            // Nothing to read: whatever course was there stays.
            status = failed(text.setupError)
            return
        }
        if (!canChooseCourse) return
        val name = fileName.ifBlank { DEFAULT_COURSE_FILE }
        work {
            val fingerprint = withContext(io) { decisions.courseFingerprint(gpxXml) }
            if (fingerprint == null) {
                status = failed(text.setupError)
                return@work
            }
            val pick = decisions.coursePick(fingerprint, held = draft.courseFingerprint, saved = draft.savedCourseFingerprint)
            if (pick == CoursePick.Unchanged && courseOnDevice && preview != null) {
                pendingCourse = null
                return@work
            }
            val picked = PendingCourse(name, gpxXml, fingerprint, saved = pick == CoursePick.SavedCourse)
            if (draft.courseFileName != null || courseSavedOnRace) {
                pendingCourse = picked
                if (!online) {
                    status = offline()
                    // The error and Try again, with no loader over the course before it.
                    if (preview != null) endMapWait()
                    return@work
                }
                previewPending(user, picked)
            } else {
                // The first file: kept on this phone at once, so offline it waits for the network.
                showPreview(null)
                hold(user, picked, null)
                if (!online) {
                    status = offline()
                    return@work
                }
                val parsed = readCourse(user, picked.fileName, picked.xml, reading = true) ?: return@work
                showPreview(parsed)
                writeDraft(
                    draft.copy(
                        plannedPaceSecondsPerKm = parsed.plannedPaceSecondsPerKm,
                        courseConfirmed = step == SetupSteps.START_TIME
                    )
                )
            }
        }
    }

    /** The course step's main button (see [courseAction]). */
    fun continueCourse(online: Boolean) {
        if (busy || pendingCourse != null) return
        when (courseAction) {
            CourseContinue.Confirm -> {
                writeDraft(draft.copy(courseConfirmed = true))
                status = SetupStatus.Ready
                moveOn(SetupSteps.START_TIME)
                validateStart()
            }
            CourseContinue.Preview -> retryCourse(online)
            // The race's course stays; nothing is uploaded again.
            CourseContinue.KeepSavedCourse -> {
                status = SetupStatus.Ready
                moveOn(SetupSteps.START_TIME)
            }
            CourseContinue.ChooseFile -> Unit
        }
    }

    /** The runner saw the course on the map; the start time comes next. */
    fun confirmCourse() {
        if (preview == null) return
        continueCourse(online = true)
    }

    /** Retries the preview after an offline or failed attempt: the picked file, else the one held. */
    fun retryCourse(online: Boolean) {
        if (busy || !canChooseCourse) return
        if (!online) {
            status = offline()
            return
        }
        status = SetupStatus.Ready
        val pending = pendingCourse
        val user = userId
        if (pending != null && user != null) {
            work { previewPending(user, pending) }
        } else {
            previewSavedCourse(force = true)
        }
    }

    /** Cancel after a file picked after Back couldn't be read: the course from before stays. */
    fun cancelPendingCourse() {
        if (busy) return
        pendingCourse = null
        status = SetupStatus.Ready
        readingCourse = false
        // Its failure already ended the wait of the course before it; no loader comes back.
        if (preview != null) endMapWait()
    }

    /**
     * The preview's map drew its first full frame: the preview replaces its loader. Not while a
     * file is read: the map under the loader is the course before it, and its frames don't end
     * the wait for the new one.
     */
    fun noteCourseMapReady() {
        if (previewingCourse) return
        endMapWait()
    }

    /**
     * The wait for the map of the preview on show is over: its map drew, its [MAP_WAIT_MS] ran
     * out, or a file picked after it couldn't be previewed. A file being read keeps its caption
     * (and the loader, [previewingCourse]) until its own preview's map is ready.
     */
    private fun endMapWait() {
        val wait = mapWait
        mapWait = null
        wait?.cancel()
        if (!courseMapReady) courseMapReady = true
        if (!previewingCourse) readingCourse = false
    }

    /** The preview on show waits for its map at most [MAP_WAIT_MS], once: a wait already running keeps its time. */
    private fun startMapWait() {
        val shown = preview?.takeIf { !it.isEmpty } ?: return
        if (courseMapReady || mapWait?.isActive == true) return
        mapWait = viewModelScope.launch {
            delay(MAP_WAIT_MS)
            // Its own path: it ends this preview's wait even while another file is read, so a
            // preview of that file that fails or is cancelled leaves no loader behind.
            if (preview == shown) endMapWait()
        }
    }

    // MARK: start time

    fun updateStart(fields: RaceStartFields) {
        writeDraft(draft.copy(start = fields))
        keepEditedStep(step)
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

    /** What the start time step's Continue does (client-core `RunnerSetupSteps.startTimeContinue`). */
    val startAction: StartTimeContinue
        get() = decisions.startTimeContinue(
            reviewing = isReviewing,
            editedThisVisit = editedStep != null && editedStep == step,
            courseUnsaved = draft.courseUnsaved == true && draft.courseFileName != null,
            courseSavedOnRace = courseSavedOnRace,
            holdsCourseFile = courseOnDevice && draft.courseFileName != null,
            start = startInstant,
            savedStart = draft.savedRaceStartAt
        )

    val canContinueStart: Boolean
        get() = roomId != null && !busy && startAction.saves

    /** The race needs its course saved and this phone lost the file: pick it again. */
    val startNeedsCourseFile: Boolean
        get() = startAction == StartTimeContinue.NeedsCourseFile

    /**
     * Continue on the start time: moves on when nothing changed, saves a start-only change with
     * `PATCH …/race-start`, and the course with the start (`PUT …/course`) when the course isn't
     * saved yet.
     */
    fun continueStart(online: Boolean) {
        val user = userId ?: return
        val room = roomId ?: return
        if (busy || step != SetupSteps.START_TIME) return
        val action = startAction
        if (!action.saves) return
        val startAt = startInstant
        if (action != StartTimeContinue.MoveOn && !isReviewing && startAt != null &&
            startAt == draft.uploadedStartAt && draft.courseUnsaved != true
        ) {
            // Already on the server; the race list just hasn't moved the flow on yet.
            moveOn(SetupSteps.HISTORY)
            effectQueue.trySend(RunnerSetupEffect.RacesChanged)
            return
        }
        when (action) {
            // Left as the race saved it: no save (it counts toward the course save limit), and
            // the history step's estimate still holds.
            StartTimeContinue.MoveOn -> {
                status = SetupStatus.Ready
                moveOn(SetupSteps.HISTORY)
            }
            StartTimeContinue.SaveStart -> if (startAt != null) {
                if (!online) status = offline() else saveStartOnly(room, startAt)
            }
            StartTimeContinue.SaveCourse -> if (startAt != null) {
                if (!online) status = offline() else saveCourseWithStart(user, room, startAt)
            }
            StartTimeContinue.NeedsCourseFile, StartTimeContinue.InvalidStart -> Unit
        }
    }

    /** `PATCH /race-rooms/:roomId/race-start`: the attached estimate moves with the start. */
    private fun saveStartOnly(room: String, startAt: String) = work {
        when (val result = withContext(io) { runtime.updateRaceStart(room, startAt) }) {
            is RuntimeResult.Failure -> fail(result, courseSave = true)
            is RuntimeResult.Success -> {
                // The estimate moved with the start; the comparison's two finishes were for the old one.
                writeDraft(draft.copy(savedRaceStartAt = startAt, uploadedStartAt = startAt, historyLine = null))
                keepComparison(null)
                teaser = null
                moveOn(SetupSteps.HISTORY)
                effectQueue.trySend(RunnerSetupEffect.RacesChanged)
            }
        }
    }

    /**
     * `PUT /race-rooms/:roomId/course` with the chosen start (the existing import path), then the
     * first estimate. It drops the estimate the history step attached, so that step runs again
     * (after a relaunch too).
     */
    private fun saveCourseWithStart(user: String, room: String, startAt: String) {
        val fileName = draft.courseFileName ?: return
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
                        val fingerprint = draft.courseFingerprint ?: withContext(io) { decisions.courseFingerprint(xml) }
                        writeDraft(
                            draft.copy(
                                uploadedStartAt = startAt,
                                courseUnsaved = false,
                                courseFingerprint = fingerprint,
                                savedCourseFingerprint = fingerprint,
                                savedRaceStartAt = startAt,
                                historyRedo = true,
                                historyAttached = false,
                                historyLine = null
                            )
                        )
                        raceListHasCourse = true
                        keepComparison(null)
                        teaser = null
                        attachPlan(room)
                        moveOn(SetupSteps.HISTORY)
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
                    // A new import: the last comparison no longer describes the plan until this one answers.
                    writeDraft(draft.copy(historyImported = true, historyAttached = false, historyLine = null))
                    keepComparison(null)
                    val room = roomId ?: return@work
                    // client-core's comparison (as on iOS): an estimate with no history, then the
                    // plan with all of it, attached; the line reads the race's finish.
                    val compared = attachPlan(room, HISTORY_COMPARE) ?: return@work
                    // Null: history changed nothing the runner can see, so the line is hidden.
                    val line = compared.optText("comparison").ifBlank { null }
                    writeDraft(draft.copy(historyAttached = true, historyLine = line))
                    keepComparison(line)
                    teaser = null
                }
            }
        }
    }

    /**
     * A history file went in on this visit (saved or already there), so Continue replaces Skip.
     * Kept in the draft, so a relaunch on the history step doesn't offer Skip again.
     */
    val historyImported: Boolean get() = draft.historyImported

    /** Continue shows after an import on this visit, and always on a history step already passed. */
    val historyShowsContinue: Boolean
        get() = decisions.historyShowsContinue(reviewing = isReviewing, importedThisVisit = draft.historyImported)

    /**
     * Continue keeps the estimate the race has (attached on this visit, or a reviewed step's)
     * unless a course save dropped it; otherwise the plan with all history first.
     */
    fun finishHistory() = finishHistory("done")

    /** A rough estimate: a cold start with no history at all, even after an import (as on iOS). */
    fun skipHistory() = finishHistory("skipped")

    private fun finishHistory(outcome: String) {
        if (busy) return
        val room = roomId
        val skipped = outcome == "skipped"
        val recomputes = skipped || decisions.historyRecomputes(
            reviewing = isReviewing,
            estimateDropped = draft.historyRedo,
            importedThisVisit = draft.historyImported,
            attachedThisVisit = draft.historyAttached
        )
        // A new estimate, or one attached on this visit: the step is marked with how it ended.
        // Moving on over an unchanged step keeps how it was marked before.
        val marks = recomputes || draft.historyAttached
        work {
            if (recomputes && room != null) {
                when (val result = withContext(io) { runtime.computeEstimate(room, if (skipped) HISTORY_NONE else null) }) {
                    is RuntimeResult.Failure -> {
                        fail(result)
                        return@work
                    }
                    // Offline, client-core answers the plan this phone cached: nothing was attached.
                    is RuntimeResult.Success -> if (result.result.optBoolean("offline")) {
                        status = offline()
                        return@work
                    }
                }
                teaser = null
            }
            writeDraft(draft.copy(historyRedo = false))
            if (!marks) {
                moveOn(SetupSteps.TEASER)
                return@work
            }
            if (onState(withContext(io) { runtime.markStep(SetupSteps.HISTORY, outcome, null) })) moveOn(SetupSteps.TEASER)
        }
    }

    // MARK: projection teaser

    private fun loadTeaser() {
        val room = roomId ?: return
        work {
            if (teaser != null) return@work
            var estimate = withContext(io) { runtime.loadEstimate(room) }
            val loaded = (estimate as? RuntimeResult.Success)?.result
            if (loaded != null && !loaded.optBoolean("hasEstimate") && !loaded.optBoolean("offline")) {
                estimate = withContext(io) { runtime.computeEstimate(room) }
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
            if (course != null && !course.isEmpty) showPreview(course)
            val schedule = (withContext(io) { runtime.loadSchedule(room) } as? RuntimeResult.Success)?.result
            val checkpoints = (course ?: preview)?.checkpointJson() ?: JSONArray()
            val projected = withContext(io) {
                runtime.timeline(schedule?.optJSONObject("sheet"), checkpoints, (course ?: preview)?.elevationJson())
            }
            val rows = parseTimeline((projected as? RuntimeResult.Success)?.result?.optJSONArray("timeline"))
            val titles = (course ?: preview)?.checkpoints?.associate { it.id to it.title }.orEmpty()
            // The schedule's finish row; client-core's plan finish (the same row) when the timeline has none.
            val finishRow = rows.lastOrNull { it.isFinish && it.clockArrivalAt != null }
            teaser = TeaserModel(
                finishAt = finishRow?.clockArrivalAt ?: plan.optText("finishAt").ifBlank { null },
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

    /** Try again on the course step waits for the race's name, like Choose course file. */
    val canRetry: Boolean
        get() = step != SetupSteps.COURSE || canChooseCourse

    // MARK: internals

    /** A step's Continue moved on to [next]: the frontier moves forward (never back), a reviewed step walks on. */
    private fun moveOn(next: String) {
        val frontier = frontier ?: return
        val move = decisions.moveOn(frontier, reviewing, next)
        leaveStep()
        if (move.frontier != frontier) keepLocalStep(move.frontier)
        if (reviewing != null) keepReviewing(move.reviewing)
        onStepShown()
    }

    /** What "this visit" means ends with the step: an edit, an import, the reading caption. */
    private fun leaveStep() {
        keepEditedStep(null)
        if (draft.historyImported || draft.historyAttached) {
            writeDraft(draft.copy(historyImported = false, historyAttached = false))
        }
        keepHistoryMessage(null)
        readingCourse = false
        resumeWatching = false
    }

    /**
     * A relaunch past a step that still has something to save opens that step again: a file picked
     * after Back and never saved, a start edited and never saved, or a history step whose estimate
     * a course save dropped. True when it opened one.
     */
    private fun resumeIfNeeded(): Boolean {
        val room = roomId ?: return false
        if (draft.roomId != room) return false
        val frontier = frontier ?: return false
        val fields = draft.start
        val open = decisions.resumeStep(
            frontier,
            courseUnsaved = draft.courseUnsaved == true && draft.courseFileName != null,
            coursePreviewed = draft.courseConfirmed,
            startUnsaved = decisions.startUnsaved(fields != null, fields?.let(::instantOf), draft.savedRaceStartAt),
            estimateDropped = draft.historyRedo
        ) ?: return false
        leaveStep()
        keepReviewing(open)
        return true
    }

    /** The race list's row for setup's race: its name, whether it has a course, its start. */
    private fun followRace(races: JSONArray?) {
        val room = roomId ?: return
        races ?: return
        val row = (0 until races.length()).mapNotNull { races.optJSONObject(it) }.firstOrNull { it.optText("id") == room } ?: return
        row.optText("name").trim().ifEmpty { null }?.let { listedRaceName = it }
        raceListHasCourse = row.optBoolean("hasCourse")
        followRaceStart(row.optText("raceStartAt").ifBlank { null }, row.optText("activatedAt").ifBlank { null })
    }

    /**
     * The race's saved start: the fields show it on a phone that never picked one, and the draft
     * remembers it as saved (client-core `RunnerSetupSteps.raceStartAdoption`).
     */
    private fun followRaceStart(raceStart: String?, activatedAt: String?) {
        if (userId == null || draft.roomId != roomId) return
        val fields = draft.start
        val adoption = decisions.raceStartAdoption(
            draftHasStart = fields != null,
            draftStart = fields?.let(::instantOf),
            savedStart = draft.savedRaceStartAt,
            raceStart = raceStart,
            activatedAt = activatedAt,
            courseUnsaved = draft.courseUnsaved == true
        )
        when (adoption.adoption) {
            RaceStartAdoption.Keep -> Unit
            RaceStartAdoption.TakeSaved -> writeDraft(draft.copy(savedRaceStartAt = adoption.raceStart))
            RaceStartAdoption.Fill -> {
                val saved = adoption.raceStart ?: return
                // The fields show the race's start in the draft's zone, else this phone's.
                val filled = fieldsOf(saved, fields?.timeZone ?: deviceZone)
                writeDraft(draft.copy(start = filled ?: draft.start, savedRaceStartAt = saved))
                if (filled != null) {
                    startInstant = null
                    validateStart()
                }
            }
        }
    }

    /** Whatever the step now on screen needs: its saved course drawn, its comparison, its teaser. */
    private fun onStepShown() {
        val shown = step ?: return
        if (shown != SetupSteps.START_TIME && dialog != null) closeDialog()
        when (shown) {
            SetupSteps.COURSE, SetupSteps.START_TIME -> previewSavedCourse()
            // After a relaunch the line comes back from the draft.
            SetupSteps.HISTORY -> if (comparison == null && draft.historyLine != null) keepComparison(draft.historyLine)
            SetupSteps.TEASER -> if (teaser == null) loadTeaser()
        }
    }

    /**
     * Creates the race with the name typed on the course step, else the race list's name for the
     * race this setup had. With neither, it fails with the name field open: a race is never named
     * after its course file. Null after a failure (shown under the step).
     */
    private suspend fun ensureRoom(user: String): String? {
        roomId?.let { return it }
        val name = decisions.newRaceName(draft.raceName.orEmpty(), listedRaceName)
        if (name == null) {
            status = failed(text.raceNameMissing, code = RACE_NAME_MISSING)
            return null
        }
        val creator = draft.displayName.trim().ifBlank { sessionFallbackName() }.ifBlank { null }
        return when (val result = withContext(io) { runtime.createRoom(name, user, creator) }) {
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
                    writeDraft(draft.copy(roomId = id, raceName = name))
                    effectQueue.trySend(RunnerSetupEffect.RoomCreated(id))
                }
                id
            }
        }
    }

    /**
     * The race this setup had is gone (or no longer the runner's): a new one gets its name (typed,
     * else the list's), and nothing the old race saved counts as saved.
     */
    private fun forgetGoneRace() {
        val name = shownRaceName.orEmpty()
        roomId = null
        raceListHasCourse = false
        writeDraft(
            draft.copy(
                roomId = null,
                // The name field is open again, holding the name the new race gets.
                raceName = name.ifEmpty { null },
                savedRaceStartAt = null,
                savedCourseFingerprint = null,
                courseUnsaved = true,
                historyRedo = false,
                uploadedStartAt = null
            )
        )
    }

    /**
     * Creates the race if there is none and previews the file there. [reading]: a picked file (the
     * loader says "Reading your course…"), not one restored after a relaunch. Null after a failure.
     */
    private suspend fun readCourse(user: String, fileName: String, xml: String, reading: Boolean): CoursePreview? {
        previewingCourse = true
        if (reading) readingCourse = true
        var parsed: CoursePreview? = null
        try {
            val room = ensureRoom(user) ?: run {
                readingCourse = false
                return null
            }
            var result = withContext(io) { runtime.gpxPreview(room, fileName, xml) }
            if (result is RuntimeResult.Failure && (result.status == 403 || result.status == 404) && draft.roomId == room) {
                // The race is gone (or no longer the runner's). Make a new one with the same name.
                forgetGoneRace()
                val fresh = ensureRoom(user) ?: run {
                    readingCourse = false
                    return null
                }
                result = withContext(io) { runtime.gpxPreview(fresh, fileName, xml) }
            }
            return when (result) {
                is RuntimeResult.Failure -> {
                    readingCourse = false
                    fail(result, courseSave = true)
                    null
                }
                is RuntimeResult.Success -> {
                    val read = CoursePreview.from(result.result)
                    if (result.result.optText("status") != "previewed" || read.isEmpty) {
                        readingCourse = false
                        status = failed(text.setupError)
                        null
                    } else {
                        parsed = read
                        read
                    }
                }
            }
        } finally {
            previewingCourse = false
            // A failed preview shows the error and Try again, with no loader: the course still on
            // show (the one before the file) ends its wait, drawn as far as its map got.
            if (parsed == null) {
                readingCourse = false
                if (preview != null) endMapWait()
            }
        }
    }

    /** Previews a file picked while a course is there; it replaces that course only once the server has read it. */
    private suspend fun previewPending(user: String, picked: PendingCourse) {
        pendingCourse = picked
        val parsed = readCourse(user, picked.fileName, picked.xml, reading = true) ?: return
        pendingCourse = null
        hold(user, picked, parsed)
    }

    /** Keeps [picked] as this phone's file for the race. A new course is saved with the start; the race's own isn't. */
    private suspend fun hold(user: String, picked: PendingCourse, parsed: CoursePreview?) {
        writeDraft(
            draft.copy(
                courseFileName = picked.fileName,
                courseFingerprint = picked.fingerprint,
                courseUnsaved = !picked.saved,
                // Another file picked on the start time stays on that step.
                courseConfirmed = parsed != null && step == SetupSteps.START_TIME,
                plannedPaceSecondsPerKm = parsed?.plannedPaceSecondsPerKm,
                uploadedStartAt = null
            )
        )
        val current = draft
        courseOnDevice = withContext(io) {
            drafts.save(user, current)
            drafts.writeCourse(user, picked.xml)
        }
        if (parsed != null) showPreview(parsed)
    }

    /** After process death or a relaunch the course is on disk but not drawn: preview it again. */
    private fun previewSavedCourse(force: Boolean = false) {
        val user = userId ?: return
        val fileName = draft.courseFileName ?: return
        // After a failure the runner retries; don't spend the preview budget on every new state.
        if (preview != null || pendingCourse != null || (status is SetupStatus.Failed && !force)) return
        // Only a tap (Try again) creates the race for a file picked offline.
        if (roomId == null && !force) return
        work {
            if (preview != null) return@work
            val xml = withContext(io) { drafts.readCourse(user) }
            courseOnDevice = xml != null
            if (xml == null) return@work
            val parsed = readCourse(user, fileName, xml, reading = force) ?: return@work
            showPreview(parsed)
            writeDraft(draft.copy(plannedPaceSecondsPerKm = parsed.plannedPaceSecondsPerKm ?: draft.plannedPaceSecondsPerKm))
        }
    }

    /** Another preview (a new file, a relaunch) waits for its own map again, at most [MAP_WAIT_MS]. */
    private fun showPreview(next: CoursePreview?) {
        if (next == preview) {
            // The same course again (the file picked again, read once more): its map is already
            // drawn, or its wait is still running (started again if it has none).
            if (courseMapReady) readingCourse = false else startMapWait()
            return
        }
        preview = next
        courseMapReady = false
        mapWait?.cancel()
        mapWait = null
        startMapWait()
    }

    /**
     * Computes and attaches a plan after a step saved (client-core retries a `course_mismatch`
     * once, silently), returning its estimate payload. Only an unpaid race's 402 (the paywall) and
     * no network (the offline copy) show; any other failure, the estimator limit included, leaves
     * the saved step as is, and the teaser computes again and says so there. Offline, client-core
     * answers ok with the plan this phone cached (`offline`), which was not attached: null, as iOS
     * throws there.
     */
    private suspend fun attachPlan(room: String, historyMode: String? = null): JSONObject? =
        when (val result = withContext(io) { runtime.computeEstimate(room, historyMode) }) {
            is RuntimeResult.Failure -> {
                if (result.status == 402 && result.code == ROOM_UNPAID) fail(result)
                null
            }
            is RuntimeResult.Success -> if (result.result.optBoolean("offline")) {
                status = offline()
                null
            } else {
                result.result
            }
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

    /** client-core's instant for [fields], at once (pure and quick), for the relaunch and race list checks. */
    private fun instantOf(fields: RaceStartFields): String? =
        (runtime.raceStartInput(fields) as? RuntimeResult.Success)?.result?.optText("raceStartAt")?.ifBlank { null }

    /** A saved start as the fields in [zone], through client-core. */
    private fun fieldsOf(raceStartAt: String, zone: String): RaceStartFields? =
        RaceStartFields.from((runtime.raceStartFields(raceStartAt, zone) as? RuntimeResult.Success)?.result)

    /** True when [result] answered a state (the shell then follows it). */
    private fun onState(result: RuntimeResult): Boolean = when (result) {
        is RuntimeResult.Failure -> {
            fail(result)
            false
        }
        is RuntimeResult.Success -> {
            result.result.optJSONObject("state")?.let { effectQueue.trySend(RunnerSetupEffect.StateChanged(it)) }
            true
        }
    }

    /**
     * [courseSave]: the request saved or previewed the course (`gpx-preview`, `PUT course`,
     * `PATCH race-start`), the only kind whose 429 has its own copy, as on iOS. Any other 429 (the
     * estimator's) is a plain failure: no shared copy names that limit yet.
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

    private fun keepReviewing(value: String?) {
        reviewing = value
        savedState[KEY_REVIEWING] = value
    }

    private fun keepLocalStep(value: String?) {
        localStep = value
        savedState[KEY_LOCAL_STEP] = value
    }

    private fun keepEditedStep(value: String?) {
        editedStep = value
        savedState[KEY_EDITED_STEP] = value
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
        val name = saved.displayName.ifBlank { sessionFallbackName() }
        return saved.copy(displayName = name)
    }

    /**
     * The session's name when the runner typed none, through client-core `SuggestedDisplayName`:
     * a session saved before email names were dropped can still carry the email. "" for none.
     */
    private fun sessionFallbackName(): String =
        sessionName?.let { runtime.suggestedDisplayName(it, null) }.orEmpty()

    /** Tomorrow at 06:00 in the device's zone, until the runner picks. */
    private fun defaultStart(): RaceStartFields {
        val day = today.plusDays(1)
        return RaceStartFields(day.year, day.monthValue, day.dayOfMonth, DEFAULT_START_HOUR, 0, deviceZone)
    }

    companion object {
        const val ROOM_UNPAID = "room_unpaid"
        /** The failure code when the race needs a name and has none ([OnboardingText.raceNameMissing]). */
        const val RACE_NAME_MISSING = "race_name_missing"
        const val DEFAULT_START_HOUR = 6
        /** The longest a preview waits for its map's first full frame before it shows anyway. */
        const val MAP_WAIT_MS = 8_000L
        private const val DEFAULT_COURSE_FILE = "course.gpx"
        private const val KEY_DRAFT = "runner-setup.draft"
        private const val KEY_HISTORY_MESSAGE = "runner-setup.history-message"
        private const val KEY_COMPARISON = "runner-setup.comparison"
        private const val KEY_SERVER_STEP = "runner-setup.server-step"
        private const val KEY_DIALOG = "runner-setup.dialog"
        private const val KEY_ZONE_FILTER = "runner-setup.zone-filter"
        private const val KEY_REVIEWING = "runner-setup.reviewing"
        private const val KEY_LOCAL_STEP = "runner-setup.local-step"
        private const val KEY_EDITED_STEP = "runner-setup.edited-step"
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
