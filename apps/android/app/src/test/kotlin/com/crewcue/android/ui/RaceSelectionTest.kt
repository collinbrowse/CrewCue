package com.crewcue.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class RaceSelectionTest {
    private val leadville = RaceChoice("a", "Leadville", "athlete", "Runner", "Ada")
    private val western = RaceChoice("b", "Western States", "crew_member", "Crew member", "Pat")

    @Test
    fun switchDuringRefreshKeepsTheRoomTheUserSelected() {
        val chosen = activeRaceAfterRefresh(
            races = listOf(leadville, western),
            sessionRoomId = "b",
            serverActiveRoomId = "a"
        )

        assertEquals("b", chosen?.id)
        assertEquals("crew_member", chosen?.role)
    }

    @Test
    fun listedSessionRoomKeepsItsServerRole() {
        val chosen = activeRaceAfterRefresh(
            races = listOf(leadville, western),
            sessionRoomId = "a",
            serverActiveRoomId = "a"
        )

        assertEquals("athlete", chosen?.role)
    }

    @Test
    fun roomMissingFromTheServerFallsBackToTheServerActiveRace() {
        val chosen = activeRaceAfterRefresh(
            races = listOf(western),
            sessionRoomId = "a",
            serverActiveRoomId = "b"
        )

        assertEquals("b", chosen?.id)
    }

    @Test
    fun emptyRosterClearsTheActiveRace() {
        val chosen = activeRaceAfterRefresh(
            races = emptyList(),
            sessionRoomId = "a",
            serverActiveRoomId = null
        )

        assertEquals(null, chosen)
    }
}
