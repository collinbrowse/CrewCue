package com.crewcue.android.ui.profile

import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.RaceChoice
import com.crewcue.android.ui.activeRaceAfterRefresh
import com.crewcue.android.ui.racesAfterDelete
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RaceDeletionTest {
    private val leadville = RaceChoice("a", "Leadville", "athlete", "Runner", "Ada", owner = true, paid = true)
    private val western = RaceChoice("b", "Western States", "athlete", "Runner", "Ada", owner = true)
    private val crewed = RaceChoice("c", "Hardrock", "crew_member", "Crew member", "Ada")
    private val text = RaceDeleteText(
        deletedMessage = "Race deleted.",
        offlineMessage = "Offline. Race not deleted.",
        genericFailureMessage = "Couldn't delete the race."
    )

    @Test
    fun deletingTheActiveRaceLeavesNoRaceActiveAndAsksForTheNext() {
        val after = racesAfterDelete(listOf(leadville, western, crewed), deletedRoomId = "a", activeRoomId = "a")
        assertEquals(listOf("b", "c"), after.races.map { it.id })
        assertNull(after.activeRoomId)
        assertTrue(after.choosing)
    }

    @Test
    fun deletingAnotherRaceOnlyRemovesItFromTheList() {
        val after = racesAfterDelete(listOf(leadville, western, crewed), deletedRoomId = "b", activeRoomId = "a")
        assertEquals(listOf("a", "c"), after.races.map { it.id })
        assertEquals("a", after.activeRoomId)
        assertFalse(after.choosing)
    }

    @Test
    fun deletingTheLastRaceLeavesAnEmptyChooser() {
        val after = racesAfterDelete(listOf(leadville), deletedRoomId = "a", activeRoomId = "a")
        assertTrue(after.races.isEmpty())
        assertTrue(after.choosing)
    }

    @Test
    fun aRefreshWhileChoosingNeverPicksTheNextRace() {
        val races = listOf(western, crewed)
        assertNull(activeRaceAfterRefresh(races, sessionRoomId = null, serverActiveRoomId = "b", awaitingChoice = true))
        // Once the person picks, that race stays active.
        assertEquals("c", activeRaceAfterRefresh(races, sessionRoomId = "c", serverActiveRoomId = "b", awaitingChoice = true)?.id)
        // Outside a choice (a fresh sign-in) the server's active race still applies.
        assertEquals("b", activeRaceAfterRefresh(races, sessionRoomId = null, serverActiveRoomId = "b")?.id)
    }

    @Test
    fun confirmedDeleteAndAlreadyGoneAreDeleted() {
        val ok = RuntimeResult.Success(JSONObject().put("deleted", true).put("message", "Race deleted."))
        assertEquals(RaceDeleteOutcome.Deleted, raceDeleteOutcome(ok, text))
    }

    @Test
    fun refusedDeleteShowsClientCoresMessage() {
        val notOwner = RuntimeResult.Success(
            JSONObject().put("deleted", false).put("message", "Only the runner who created this race can delete it.")
        )
        assertEquals(
            RaceDeleteOutcome.Failed("Only the runner who created this race can delete it."),
            raceDeleteOutcome(notOwner, text)
        )
        val blank = RuntimeResult.Success(JSONObject().put("deleted", false))
        assertEquals(RaceDeleteOutcome.Failed("Couldn't delete the race."), raceDeleteOutcome(blank, text))
    }

    @Test
    fun bridgeFailureSaysOfflineOnlyWhenOffline() {
        val offline = RuntimeResult.Failure("no network", offline = true)
        assertEquals(RaceDeleteOutcome.Failed("Offline. Race not deleted."), raceDeleteOutcome(offline, text))
        val phoneOffline = RuntimeResult.Failure("Request failed", offline = false)
        assertEquals(RaceDeleteOutcome.Failed("Offline. Race not deleted."), raceDeleteOutcome(phoneOffline, text, online = false))
        assertEquals(RaceDeleteOutcome.Failed("Couldn't delete the race."), raceDeleteOutcome(phoneOffline, text, online = true))
    }

    @Test
    fun copyReadsEveryFieldFromClientCore() {
        val copy = RaceDeleteText.from(
            JSONObject()
                .put("rowTitle", "Delete race")
                .put("rowDetail", "Remove this race for the whole crew")
                .put("confirmTitle", "Delete Leadville?")
                .put("confirmBody", "You'll lose this race's Race Pass.")
                .put("confirmButton", "Delete race")
                .put("cancelButton", "Cancel")
        )
        assertEquals("Delete race", copy.rowTitle)
        assertEquals("Remove this race for the whole crew", copy.rowDetail)
        assertEquals("Delete Leadville?", copy.confirmTitle)
        assertEquals("Cancel", copy.cancelButton)
    }
}
