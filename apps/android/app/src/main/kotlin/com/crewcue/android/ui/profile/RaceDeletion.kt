package com.crewcue.android.ui.profile

import com.crewcue.android.data.RuntimeResult
import org.json.JSONObject

/**
 * Delete race strings, all from client-core (`raceDeletionCopy`, `RaceDeletion`). [confirmTitle]
 * and [confirmBody] are built for the race the copy was read for.
 */
data class RaceDeleteText(
    val rowTitle: String = "",
    val rowDetail: String = "",
    val confirmTitle: String = "",
    val confirmBody: String = "",
    val confirmButton: String = "",
    val cancelButton: String = "",
    val deletedMessage: String = "",
    val offlineMessage: String = "",
    val genericFailureMessage: String = ""
) {
    companion object {
        fun from(json: JSONObject?): RaceDeleteText {
            if (json == null) return RaceDeleteText()
            return RaceDeleteText(
                rowTitle = json.optString("rowTitle"),
                rowDetail = json.optString("rowDetail"),
                confirmTitle = json.optString("confirmTitle"),
                confirmBody = json.optString("confirmBody"),
                confirmButton = json.optString("confirmButton"),
                cancelButton = json.optString("cancelButton"),
                deletedMessage = json.optString("deletedMessage"),
                offlineMessage = json.optString("offlineMessage"),
                genericFailureMessage = json.optString("genericFailureMessage")
            )
        }
    }
}

/** What Delete race did. Only [Deleted] removes the race from the list. */
sealed interface RaceDeleteOutcome {
    data object Deleted : RaceDeleteOutcome
    data class Failed(val message: String) : RaceDeleteOutcome
}

/**
 * The `deleteRace` result as the person sees it. A bridge failure (no answer at all) says offline
 * when the phone is offline, else the shared generic failure. Pure, so it is unit-tested on the JVM.
 */
fun raceDeleteOutcome(result: RuntimeResult, text: RaceDeleteText, online: Boolean = true): RaceDeleteOutcome =
    when (result) {
        is RuntimeResult.Success ->
            if (result.result.optBoolean("deleted")) {
                RaceDeleteOutcome.Deleted
            } else {
                RaceDeleteOutcome.Failed(result.result.optString("message").ifBlank { text.genericFailureMessage })
            }
        is RuntimeResult.Failure ->
            RaceDeleteOutcome.Failed(if (result.offline || !online) text.offlineMessage else text.genericFailureMessage)
    }
