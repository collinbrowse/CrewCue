package com.crewcue.android.ui.profile

import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.RaceChoice
import org.json.JSONObject

/**
 * Rename race strings and who may rename, all from client-core (`raceRenameCopy`,
 * `RaceRenameCopy`, `PlanAuthority.mayEditRaceSetup`). clients/behavior/race-rename.md.
 */
data class RaceRenameText(
    val rowTitle: String = "",
    val rowDetail: String = "",
    val hint: String = "",
    val saved: String = "",
    val failed: String = "",
    val offline: String = "",
    val invalid: String = "",
    val maxLength: Int = 80,
    /** The runner, crew chiefs and team managers; never crew members. */
    val mayRename: Boolean = false
) {
    companion object {
        fun from(json: JSONObject?): RaceRenameText {
            if (json == null) return RaceRenameText()
            return RaceRenameText(
                rowTitle = json.optString("rowTitle"),
                rowDetail = json.optString("rowDetail"),
                hint = json.optString("hint"),
                saved = json.optString("saved"),
                failed = json.optString("failed"),
                offline = json.optString("offline"),
                invalid = json.optString("invalid"),
                maxLength = json.optInt("maxLength", 80),
                mayRename = json.optBoolean("mayRename")
            )
        }
    }
}

/** What Rename race did. Only [Renamed] changes the race list and the top bar. */
sealed interface RaceRenameOutcome {
    data class Renamed(val roomId: String, val name: String, val message: String) : RaceRenameOutcome
    data class Failed(val message: String) : RaceRenameOutcome
}

/**
 * The `renameRace` result as the person sees it. A bridge failure (no answer at all) says
 * offline when the phone is offline, else the shared failure line. Pure, so it is unit-tested.
 */
fun raceRenameOutcome(result: RuntimeResult, text: RaceRenameText, online: Boolean = true): RaceRenameOutcome =
    when (result) {
        is RuntimeResult.Success -> {
            val json = result.result
            val name = json.optString("name").trim()
            val id = json.optString("id")
            if (json.optBoolean("renamed") && name.isNotEmpty() && id.isNotEmpty()) {
                RaceRenameOutcome.Renamed(id, name, json.optString("message").ifBlank { text.saved })
            } else {
                RaceRenameOutcome.Failed(json.optString("message").ifBlank { text.failed })
            }
        }
        is RuntimeResult.Failure ->
            RaceRenameOutcome.Failed(if (result.offline || !online) text.offline else text.failed)
    }

/** The race list after [roomId] was renamed to [name]: same order, same active race. */
fun racesAfterRename(races: List<RaceChoice>, roomId: String, name: String): List<RaceChoice> =
    races.map { if (it.id == roomId) it.copy(name = name) else it }
