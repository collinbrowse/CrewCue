package com.crewcue.android.session

import org.junit.Assert.assertEquals
import org.junit.Test

class JoinSessionTest {
    @Test
    fun joinAppliesServerAthleteRole() {
        val session = StoredSession(
            userId = "runner",
            role = "crew_member",
            token = "token",
            displayName = null,
            roomId = null,
            fromAuth0 = true
        )

        val next = session.applyingJoin("room-1", "athlete")

        assertEquals("room-1", next.roomId)
        assertEquals("athlete", next.role)
        assertEquals("token", next.token)
        assertEquals("runner", next.userId)
    }

    @Test
    fun blankAssignedRoleDoesNotReplaceTheCurrentRole() {
        val session = StoredSession(
            userId = "runner",
            role = "athlete",
            token = "token",
            displayName = "Ada",
            roomId = "old-room",
            fromAuth0 = true
        )

        val next = session.applyingJoin("  room-2  ", "   ")

        assertEquals("room-2", next.roomId)
        assertEquals("athlete", next.role)
        assertEquals("Ada", next.displayName)
    }

    @Test
    fun blankRoomIdKeepsTheCurrentRoom() {
        val session = StoredSession(
            userId = "crew",
            role = "crew_member",
            token = "token",
            displayName = null,
            roomId = "room-1",
            fromAuth0 = true
        )

        val next = session.applyingJoin(" ", "crew_chief")

        assertEquals("room-1", next.roomId)
        assertEquals("crew_chief", next.role)
    }
}
