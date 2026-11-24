package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import org.json.JSONObject

/** What the course step's main button does (client-core `RunnerSetupSteps.CourseContinue`). */
enum class CourseContinue(val wire: String) {
    /** The picked file is previewed: on to the start time. */
    Confirm("confirm"),
    /** The picked file has no preview yet (offline, a relaunch): preview it first. */
    Preview("preview"),
    /** This phone holds no file and the race saved a course: "Course saved" and Continue, nothing uploaded. */
    KeepSavedCourse("keepSavedCourse"),
    /** Nothing to continue with yet: the runner picks a file. */
    ChooseFile("chooseFile");

    companion object {
        fun from(wire: String?): CourseContinue = entries.firstOrNull { it.wire == wire } ?: ChooseFile
    }
}

/** What a picked course file is, by its content (client-core `RunnerSetupSteps.CoursePick`). */
enum class CoursePick(val wire: String) {
    /** The file this phone already holds for the race, picked again: nothing changes. */
    Unchanged("unchanged"),
    /** The course the race already saved from this phone: it isn't saved twice. */
    SavedCourse("savedCourse"),
    /** Another course: it is saved with the start time. */
    NewCourse("newCourse");

    companion object {
        fun from(wire: String?): CoursePick = entries.firstOrNull { it.wire == wire } ?: NewCourse
    }
}

/** What the start time step's Continue does (client-core `RunnerSetupSteps.StartTimeContinue`). */
enum class StartTimeContinue(val wire: String) {
    /** Nothing changed: open the next step, no request. */
    MoveOn("moveOn"),
    /** Only the start changed, on a race with a course: `PATCH …/race-start`. */
    SaveStart("saveStart"),
    /** The course is saved with the start: `PUT …/course`, which drops the attached estimate. */
    SaveCourse("saveCourse"),
    /** The course has to be saved and this phone doesn't hold its file: pick it again. */
    NeedsCourseFile("needsCourseFile"),
    /** The start on screen isn't a real time (or client-core hasn't answered for it yet). */
    InvalidStart("invalidStart");

    val saves: Boolean get() = this == MoveOn || this == SaveStart || this == SaveCourse

    companion object {
        fun from(wire: String?): StartTimeContinue = entries.firstOrNull { it.wire == wire } ?: InvalidStart
    }
}

/** What the race list's start does to the start time fields (client-core `RunnerSetupSteps.RaceStartAdoption`). */
enum class RaceStartAdoption(val wire: String) {
    Keep("keep"),
    /** Remember the race's start as the saved one; the fields stay. */
    TakeSaved("takeSaved"),
    /** Fill the fields from the race's start, and remember it as saved. */
    Fill("fill");

    companion object {
        fun from(wire: String?): RaceStartAdoption = entries.firstOrNull { it.wire == wire } ?: Keep
    }
}

/**
 * What the step on screen shows and does: client-core's answers for one [Inputs]. The ViewModel
 * asks for them off Main whenever an input changes and the screen reads only this, so drawing a
 * frame never waits on the bridge.
 */
data class SetupRules(
    /** The furthest step setup has reached; null while client-core's state names none. */
    val frontier: String?,
    /** The step on screen: the frontier, or a step behind it the runner went Back to. */
    val step: String?,
    /** [step] is behind the frontier: opened with Back, or by a relaunch. */
    val reviewing: Boolean,
    /** The step Back opens; null on the first step, where Back leaves setup. */
    val previous: String?,
    val canGoBack: Boolean,
    val courseAction: CourseContinue,
    val startAction: StartTimeContinue,
    val historyShowsContinue: Boolean
) {
    /** What the rules read, all of it taken from the ViewModel's state at once. */
    data class Inputs(
        /** client-core's step, with a previewed course moved on to the start time on this phone. */
        val serverFrontier: String?,
        /** A step ahead of client-core's after a save the race list hasn't answered for yet. */
        val localStep: String?,
        /** The step the runner went Back to (or a relaunch reopened). */
        val reviewing: String?,
        val raceExists: Boolean,
        /** This phone holds the picked course file. */
        val holdsPickedFile: Boolean,
        val previewed: Boolean,
        val courseSavedOnRace: Boolean,
        /** The step the runner changed something on since it opened. */
        val editedStep: String?,
        /** A picked file the race hasn't saved yet. */
        val courseUnsaved: Boolean,
        /** client-core's instant for the start fields, null while they name none. */
        val start: String?,
        val savedStart: String?,
        val historyImported: Boolean
    )

    companion object {
        /** Before client-core has answered, or while its state names no step: no step on screen. */
        val Unknown = SetupRules(
            frontier = null,
            step = null,
            reviewing = false,
            previous = null,
            canGoBack = false,
            courseAction = CourseContinue.ChooseFile,
            startAction = StartTimeContinue.InvalidStart,
            historyShowsContinue = false
        )
    }
}

/**
 * client-core `RunnerSetupSteps`, the rules for moving between the runner's setup steps and for
 * what a reviewed step's Continue saves, read through the `runnerSetupStep` op. Kotlin never
 * decides these itself. Every call blocks on the bridge: call them off Main. The rules are pure,
 * so answers are kept for inputs already asked.
 */
class SetupDecisions(private val runtime: RunnerSetupRuntime) {
    /** The step on screen, and where Back goes from it. */
    data class Navigation(
        val shown: String,
        /** [shown] while it is behind the frontier, else null. */
        val reviewing: String?,
        /** The step Back opens; null on the first step, where Back leaves setup. */
        val previous: String?,
        val canGoBack: Boolean
    )

    /** The frontier and the reviewed step after a Continue opened the next step. */
    data class Move(val frontier: String, val reviewing: String?)

    data class Adoption(val adoption: RaceStartAdoption, val raceStart: String?)

    private val answers = object : LinkedHashMap<String, JSONObject>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, JSONObject>?): Boolean = size > MAX_KEPT
    }

    private fun ask(decision: String, input: JSONObject): JSONObject? {
        val key = "$decision $input"
        synchronized(answers) { answers[key]?.let { return it } }
        val answer = (runtime.setupStep(decision, input) as? RuntimeResult.Success)?.result ?: return null
        synchronized(answers) { answers[key] = answer }
        return answer
    }

    /** Every answer the step on screen reads, for [inputs] ([SetupRules]). */
    fun rules(inputs: SetupRules.Inputs): SetupRules {
        val server = inputs.serverFrontier ?: return SetupRules.Unknown
        val frontier = inputs.localStep?.let { moveOn(server, null, it).frontier } ?: server
        val navigation = navigation(frontier, inputs.reviewing, inputs.raceExists)
        val reviewing = navigation.reviewing != null
        return SetupRules(
            frontier = frontier,
            step = navigation.shown,
            reviewing = reviewing,
            previous = navigation.previous,
            canGoBack = navigation.canGoBack,
            courseAction = courseContinue(inputs.holdsPickedFile, inputs.previewed, inputs.courseSavedOnRace),
            startAction = startTimeContinue(
                reviewing = reviewing,
                editedThisVisit = inputs.editedStep != null && inputs.editedStep == navigation.shown,
                courseUnsaved = inputs.courseUnsaved,
                courseSavedOnRace = inputs.courseSavedOnRace,
                holdsCourseFile = inputs.holdsPickedFile,
                start = inputs.start,
                savedStart = inputs.savedStart
            ),
            historyShowsContinue = historyShowsContinue(reviewing = reviewing, importedThisVisit = inputs.historyImported)
        )
    }

    fun navigation(frontier: String, reviewing: String?, raceExists: Boolean): Navigation {
        val answer = ask(
            "navigation",
            JSONObject().put("frontier", frontier).putOpt("reviewing", reviewing).put("raceExists", raceExists)
        ) ?: return Navigation(frontier, null, null, false)
        return Navigation(
            shown = answer.optText("shown").ifBlank { frontier },
            reviewing = answer.optText("reviewing").ifBlank { null },
            previous = answer.optText("previous").ifBlank { null },
            canGoBack = answer.optBoolean("canGoBack")
        )
    }

    fun moveOn(frontier: String, reviewing: String?, next: String): Move {
        val answer = ask("moveOn", JSONObject().put("frontier", frontier).putOpt("reviewing", reviewing).put("next", next))
            ?: return Move(frontier, reviewing)
        return Move(answer.optText("frontier").ifBlank { frontier }, answer.optText("reviewing").ifBlank { null })
    }

    /** The name a new race is created with; null when there is none (never the course file's). */
    fun newRaceName(typed: String, listed: String?): String? =
        ask("newRaceName", JSONObject().put("typed", typed).putOpt("listed", listed))?.optText("name")?.ifBlank { null }

    /** The content fingerprint of a course file. Reads the whole file: call it off Main. Not kept. */
    fun courseFingerprint(xml: String): String? =
        (runtime.setupStep("courseFingerprint", JSONObject().put("xml", xml)) as? RuntimeResult.Success)
            ?.result?.optText("fingerprint")?.ifBlank { null }

    fun coursePick(fingerprint: String, held: String?, saved: String?): CoursePick = CoursePick.from(
        ask("coursePick", JSONObject().put("fingerprint", fingerprint).putOpt("held", held).putOpt("saved", saved))?.optText("pick")
    )

    fun courseContinue(holdsPickedFile: Boolean, previewed: Boolean, courseSavedOnRace: Boolean): CourseContinue = CourseContinue.from(
        ask(
            "courseContinue",
            JSONObject().put("holdsPickedFile", holdsPickedFile).put("previewed", previewed).put("courseSavedOnRace", courseSavedOnRace)
        )?.optText("action")
    )

    fun startUnsaved(draftHasStart: Boolean, draftStart: String?, savedStart: String?): Boolean =
        ask(
            "startUnsaved",
            JSONObject().put("draftHasStart", draftHasStart).putOpt("draftStart", draftStart).putOpt("savedStart", savedStart)
        )?.optBoolean("value") ?: false

    fun startTimeContinue(
        reviewing: Boolean,
        editedThisVisit: Boolean,
        courseUnsaved: Boolean,
        courseSavedOnRace: Boolean,
        holdsCourseFile: Boolean,
        start: String?,
        savedStart: String?
    ): StartTimeContinue = StartTimeContinue.from(
        ask(
            "startTimeContinue",
            JSONObject()
                .put("reviewing", reviewing)
                .put("editedThisVisit", editedThisVisit)
                .put("courseUnsaved", courseUnsaved)
                .put("courseSavedOnRace", courseSavedOnRace)
                .put("holdsCourseFile", holdsCourseFile)
                .putOpt("start", start)
                .putOpt("savedStart", savedStart)
        )?.optText("action")
    )

    fun raceStartAdoption(
        draftHasStart: Boolean,
        draftStart: String?,
        savedStart: String?,
        raceStart: String?,
        activatedAt: String?,
        courseUnsaved: Boolean
    ): Adoption {
        val answer = ask(
            "raceStartAdoption",
            JSONObject()
                .put("draftHasStart", draftHasStart)
                .putOpt("draftStart", draftStart)
                .putOpt("savedStart", savedStart)
                .putOpt("raceStart", raceStart)
                .putOpt("activatedAt", activatedAt)
                .put("courseUnsaved", courseUnsaved)
        ) ?: return Adoption(RaceStartAdoption.Keep, null)
        return Adoption(RaceStartAdoption.from(answer.optText("adoption")), answer.optText("raceStart").ifBlank { null })
    }

    fun historyShowsContinue(reviewing: Boolean, importedThisVisit: Boolean): Boolean =
        ask("historyShowsContinue", JSONObject().put("reviewing", reviewing).put("importedThisVisit", importedThisVisit))
            ?.optBoolean("value") ?: importedThisVisit

    /** True when the history step's Continue computes and attaches an estimate; false keeps the race's. */
    fun historyRecomputes(reviewing: Boolean, estimateDropped: Boolean, importedThisVisit: Boolean, attachedThisVisit: Boolean): Boolean =
        ask(
            "historyContinue",
            JSONObject()
                .put("reviewing", reviewing)
                .put("estimateDropped", estimateDropped)
                .put("importedThisVisit", importedThisVisit)
                .put("attachedThisVisit", attachedThisVisit)
        )?.optText("action") != "moveOn"

    /** The step a relaunch reopens behind [frontier], or null to stay on it. */
    fun resumeStep(frontier: String, courseUnsaved: Boolean, coursePreviewed: Boolean, startUnsaved: Boolean, estimateDropped: Boolean): String? =
        ask(
            "resumeStep",
            JSONObject()
                .put("frontier", frontier)
                .put("courseUnsaved", courseUnsaved)
                .put("coursePreviewed", coursePreviewed)
                .put("startUnsaved", startUnsaved)
                .put("estimateDropped", estimateDropped)
        )?.optText("step")?.ifBlank { null }

    private companion object {
        const val MAX_KEPT = 128
    }
}
