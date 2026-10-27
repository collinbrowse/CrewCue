package com.crewcue.android.ui

/**
 * Which loaded race stays active after `myRaces` returns.
 *
 * The request is started with the room id from that moment. The user can switch
 * races before the response arrives. The room they are on now wins while the
 * server still lists it, so that switch is not replaced by the earlier id.
 * A room they left or were removed from falls back to the server's active race,
 * then to the first listed race.
 */
fun activeRaceAfterRefresh(
    races: List<RaceChoice>,
    sessionRoomId: String?,
    serverActiveRoomId: String?
): RaceChoice? {
    val session = sessionRoomId?.trim()?.takeIf { it.isNotEmpty() }
    if (session != null) {
        races.firstOrNull { it.id == session }?.let { return it }
    }
    val server = serverActiveRoomId?.trim()?.takeIf { it.isNotEmpty() }
    if (server != null) {
        races.firstOrNull { it.id == server }?.let { return it }
    }
    return races.firstOrNull()
}
