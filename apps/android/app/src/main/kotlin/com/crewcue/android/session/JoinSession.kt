package com.crewcue.android.session

/**
 * Join-by-code returns the caller's membership role. Sign-in defaults to
 * `crew_member`, and that default must not stick when the server says otherwise.
 * Location upload is athlete-only, so dropping `assignedRole` stops the runner's phone.
 */
fun StoredSession.applyingJoin(roomId: String, assignedRole: String): StoredSession {
    val nextRoom = roomId.trim().ifEmpty { this.roomId }
    val nextRole = assignedRole.trim().ifEmpty { role }
    return copy(roomId = nextRoom, role = nextRole)
}
