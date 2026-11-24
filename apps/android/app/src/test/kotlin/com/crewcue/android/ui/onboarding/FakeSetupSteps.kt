package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import java.security.MessageDigest
import java.time.Instant
import org.json.JSONObject

/**
 * A test double for the `runnerSetupStep` op, so the JVM tests drive [RunnerSetupViewModel]
 * without the Swift runtime. It answers as client-core `RunnerSetupSteps` does; the rules are
 * Swift's and are tested there (RunnerSetupStepsTests, RunnerSetupStepRuntimeTests). Production
 * Kotlin never decides them: it reads them through [SetupDecisions].
 */
object FakeSetupSteps {
    private val order = SetupSteps.all

    fun answer(decision: String, input: JSONObject): RuntimeResult {
        fun text(key: String): String? = input.optText(key).trim().ifEmpty { null }
        fun flag(key: String): Boolean = input.optBoolean(key)
        fun step(key: String): String? = text(key)?.takeIf { it in order }
        val missing = RuntimeResult.Failure("A runner setup step is required.", offline = false, status = 400)
        val result: JSONObject = when (decision) {
            "navigation" -> {
                val frontier = step("frontier") ?: return missing
                val reviewing = step("reviewing")
                val shown = if (reviewing != null && index(reviewing) < index(frontier)) reviewing else frontier
                val previous = order.getOrNull(index(shown) - 1)
                JSONObject()
                    .put("shown", shown)
                    .put("reviewing", if (shown == frontier) JSONObject.NULL else shown)
                    .put("previous", previous ?: JSONObject.NULL)
                    .put("canGoBack", previous != null || !flag("raceExists"))
            }
            "moveOn" -> {
                val next = step("next") ?: return missing
                val before = step("frontier") ?: return missing
                val frontier = if (index(next) > index(before)) next else before
                val reviewing = if (step("reviewing") == null || index(next) >= index(frontier)) null else next
                JSONObject().put("frontier", frontier).put("reviewing", reviewing ?: JSONObject.NULL)
            }
            "newRaceName" -> {
                val name = input.optText("typed").trim().ifEmpty { null } ?: text("listed")
                JSONObject().put("name", name ?: JSONObject.NULL)
            }
            "courseFingerprint" -> JSONObject().put("fingerprint", fingerprint(input.optText("xml")))
            "coursePick" -> {
                val fingerprint = input.optText("fingerprint")
                val pick = when (fingerprint) {
                    text("held") -> "unchanged"
                    text("saved") -> "savedCourse"
                    else -> "newCourse"
                }
                JSONObject().put("pick", pick)
            }
            "courseContinue" -> {
                val action = when {
                    flag("holdsPickedFile") -> if (flag("previewed")) "confirm" else "preview"
                    flag("courseSavedOnRace") -> "keepSavedCourse"
                    else -> "chooseFile"
                }
                JSONObject().put("action", action)
            }
            "startUnsaved" -> JSONObject().put("value", startUnsaved(flag("draftHasStart"), text("draftStart"), text("savedStart")))
            "startTimeContinue" -> JSONObject().put("action", startTimeContinue(input))
            "raceStartAdoption" -> {
                val raceStart = text("raceStart") ?: text("activatedAt")
                val adoption = when {
                    raceStart == null || minute(raceStart) == null -> "keep"
                    !flag("draftHasStart") -> "fill"
                    sameStart(text("savedStart"), raceStart) -> "keep"
                    !flag("courseUnsaved") && sameStart(text("draftStart"), text("savedStart")) -> "fill"
                    else -> "takeSaved"
                }
                JSONObject().put("adoption", adoption).put("raceStart", raceStart ?: JSONObject.NULL)
            }
            "historyShowsContinue" -> JSONObject().put(
                "value",
                flag("reviewing") || flag("importedThisVisit") || flag("raceHasEstimate")
            )
            "historyContinue" -> {
                val action = when {
                    flag("attachedThisVisit") -> "moveOn"
                    flag("estimateDropped") || flag("importedThisVisit") -> "recompute"
                    flag("reviewing") -> "moveOn"
                    flag("raceHasEstimate") -> "keepRaceEstimate"
                    else -> "recompute"
                }
                JSONObject().put("action", action).put("marks", action != "moveOn" || flag("attachedThisVisit"))
            }
            "resumeStep" -> {
                val frontier = step("frontier") ?: return missing
                val past = index(frontier)
                val open = when {
                    past > index(SetupSteps.START_TIME) && flag("courseUnsaved") ->
                        if (flag("coursePreviewed")) SetupSteps.START_TIME else SetupSteps.COURSE
                    past > index(SetupSteps.START_TIME) && flag("startUnsaved") -> SetupSteps.START_TIME
                    past > index(SetupSteps.HISTORY) && flag("estimateDropped") -> SetupSteps.HISTORY
                    else -> null
                }
                JSONObject().put("step", open ?: JSONObject.NULL)
            }
            else -> return RuntimeResult.Failure("Unknown runner setup decision $decision.", offline = false, status = 400)
        }
        return RuntimeResult.Success(result)
    }

    /** client-core `RunnerSetupSteps.courseFingerprint`: SHA-256 over the trimmed text, lowercase hex. */
    fun fingerprint(xml: String): String =
        MessageDigest.getInstance("SHA-256").digest(xml.trim().toByteArray()).joinToString("") { "%02x".format(it) }

    private fun index(step: String): Int = order.indexOf(step)

    private fun minute(value: String?): Long? =
        value?.let { runCatching { Instant.parse(it).epochSecond }.getOrNull() }?.let { Math.floorDiv(it, 60L) }

    private fun sameStart(a: String?, b: String?): Boolean {
        val first = minute(a) ?: return false
        return first == (minute(b) ?: return false)
    }

    private fun startUnsaved(draftHasStart: Boolean, draftStart: String?, savedStart: String?): Boolean =
        draftHasStart && savedStart != null && !sameStart(draftStart, savedStart)

    private fun startTimeContinue(input: JSONObject): String {
        fun text(key: String): String? = input.optText(key).trim().ifEmpty { null }
        val start = text("start")
        val savedStart = text("savedStart")
        val holds = input.optBoolean("holdsCourseFile")
        if (input.optBoolean("courseUnsaved")) {
            if (start == null) return "invalidStart"
            return if (holds) "saveCourse" else "needsCourseFile"
        }
        if (input.optBoolean("reviewing")) {
            val changed = input.optBoolean("editedThisVisit") || startUnsaved(true, start, savedStart)
            if (!changed || sameStart(start, savedStart)) return "moveOn"
        }
        if (start == null) return "invalidStart"
        if (input.optBoolean("courseSavedOnRace")) return "saveStart"
        return if (holds) "saveCourse" else "needsCourseFile"
    }
}
