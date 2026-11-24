package com.crewcue.android.ui.join

import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import org.json.JSONObject

/** The join screen's test tag (`clients/behavior/join-crew.md`). */
const val JOIN_CREW_FEATURE = "join-crew"

/** The launch extra a debug build reads as a faked Play install referrer (proofs only). */
const val FAKE_REFERRER_EXTRA = "crewcueFakeReferrer"

/** The device's pending invite from client-core (`PendingJoin`): its code and where it came from. */
data class PendingInvite(val code: String, val source: String) {
    companion object {
        /** `readPendingJoin` / `savePendingJoin`'s `pendingJoin`, or null for none or a failed read. */
        fun from(result: RuntimeResult): PendingInvite? {
            val row = (result as? RuntimeResult.Success)?.result?.optJSONObject("pendingJoin") ?: return null
            val code = row.optText("code").trim()
            if (code.isEmpty()) return null
            return PendingInvite(code, row.optText("source").ifBlank { SOURCE_TYPED })
        }

        const val SOURCE_LINK = "link"
        const val SOURCE_REFERRER = "referrer"
        const val SOURCE_TYPED = "typed"
    }
}

/** How the join screen shows a body line (the checklist states). */
enum class JoinTone { Success, Error, Offline }

/**
 * What joining the pending invite came to, for the join screen and the session. client-core
 * (`PendingJoinOutcome`) decides the outcome and its words; this only maps them.
 */
data class JoinResult(
    val outcome: String,
    /** The race joined, or the one the user was already in. */
    val roomId: String?,
    /** The role to store with that race; blank keeps the session's until the race list says. */
    val role: String,
    /** The line under the code: null for a fresh join (the screen says "Joined <race>."). */
    val message: String?,
    val tone: JoinTone,
    /**
     * What is still pending after a join that landed: a newer link opened while the join was out
     * (`PendingJoinStore.nextCode`), whose join screen comes next. Null otherwise.
     */
    val next: PendingInvite? = null
) {
    val joined: Boolean get() = roomId != null

    companion object {
        const val FAILED = "Couldn't join this race. Try again."
        const val OFFLINE = "Offline. Joining a race needs the network."

        fun from(result: RuntimeResult): JoinResult = when (result) {
            is RuntimeResult.Failure -> JoinResult(
                outcome = if (result.offline) "offline" else "failed",
                roomId = null,
                role = "",
                message = if (result.offline) OFFLINE else FAILED,
                tone = if (result.offline) JoinTone.Offline else JoinTone.Error
            )
            is RuntimeResult.Success -> from(result.result)
        }

        fun from(json: JSONObject): JoinResult {
            val outcome = json.optText("outcome")
            val roomId = json.optText("roomId").trim().ifEmpty { null }
            val message = json.optText("message").trim().ifEmpty { null }
            val next = PendingInvite.from(RuntimeResult.Success(json))
            return when (outcome) {
                // join-by-code makes every new member crew; the runner rejoining their own race
                // is `alreadyMember`, whose role the race list brings.
                "joined" -> JoinResult(outcome, roomId, "crew_member", null, JoinTone.Success, next)
                "alreadyMember" -> JoinResult(outcome, roomId, "", message, JoinTone.Success, next)
                "offline" -> JoinResult(outcome, null, "", message ?: OFFLINE, JoinTone.Offline)
                else -> JoinResult(outcome, null, "", message ?: FAILED, JoinTone.Error)
            }
        }
    }
}

/** The preview's line: client-core's "You're joining Ana's race: …", else the race name. */
fun joiningLine(preview: JSONObject): String? =
    preview.optText("joiningLine").trim().ifEmpty { null }
        ?: preview.optText("roomName").trim().ifEmpty { null }
