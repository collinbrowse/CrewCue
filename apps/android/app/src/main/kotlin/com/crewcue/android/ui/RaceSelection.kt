package com.crewcue.android.ui

/**
 * Which loaded race stays active after `myRaces` returns.
 *
 * The request is started with the room id from that moment. The user can switch
 * races before the response arrives. The room they are on now wins while the
 * server still lists it, so that switch is not replaced by the earlier id.
 * A room they left or were removed from falls back to the server's active race,
 * then to the first listed race.
 *
 * [awaitingChoice]: the person deleted their active race and hasn't picked the next one. While no
 * race is active, none becomes active: the app never picks the next race for them.
 */
fun activeRaceAfterRefresh(
    races: List<RaceChoice>,
    sessionRoomId: String?,
    serverActiveRoomId: String?,
    awaitingChoice: Boolean = false
): RaceChoice? {
    val session = sessionRoomId?.trim()?.takeIf { it.isNotEmpty() }
    if (session != null) {
        races.firstOrNull { it.id == session }?.let { return it }
    }
    if (awaitingChoice && session == null) return null
    val server = serverActiveRoomId?.trim()?.takeIf { it.isNotEmpty() }
    if (server != null) {
        races.firstOrNull { it.id == server }?.let { return it }
    }
    return races.firstOrNull()
}

/**
 * The race list once [deletedRoomId] is gone. [activeRoomId] is null and [choosing] is true when
 * the deleted race was the active one: the person picks the next race from the chooser.
 */
data class RacesAfterDelete(val races: List<RaceChoice>, val activeRoomId: String?, val choosing: Boolean)

fun racesAfterDelete(races: List<RaceChoice>, deletedRoomId: String, activeRoomId: String?): RacesAfterDelete {
    val remaining = races.filter { it.id != deletedRoomId }
    val wasActive = activeRoomId == deletedRoomId
    return RacesAfterDelete(remaining, if (wasActive) null else activeRoomId, choosing = wasActive)
}

/** The top bar's title: the active race's name, or CrewCue with no race (or a blank name). */
fun topBarTitle(races: List<RaceChoice>, roomId: String?): String =
    races.firstOrNull { it.id == roomId }?.name?.trim()?.ifEmpty { null } ?: "CrewCue"
