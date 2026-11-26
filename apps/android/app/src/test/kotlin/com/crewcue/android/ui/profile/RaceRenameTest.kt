package com.crewcue.android.ui.profile

import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.RaceChoice
import com.crewcue.android.ui.topBarTitle
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RaceRenameTest {
    private val text = RaceRenameText(
        saved = "Race renamed.",
        failed = "Couldn't rename the race.",
        offline = "Offline. Race name not changed.",
        invalid = "Enter a race name of up to 80 characters."
    )
    private val leadville = RaceChoice("a", "Leadville", "athlete", "Runner", "Ada", owner = true)
    private val hardrock = RaceChoice("c", "Hardrock", "crew_member", "Crew member", "Ada")

    @Test
    fun aSavedRenameCarriesTheServersName() {
        val result = RuntimeResult.Success(JSONObject("""{"renamed":true,"id":"a","name":"Leadville 100","message":"Race renamed."}"""))
        assertEquals(RaceRenameOutcome.Renamed("a", "Leadville 100", "Race renamed."), raceRenameOutcome(result, text))
    }

    @Test
    fun aRefusedRenameShowsClientCoresLine() {
        val result = RuntimeResult.Success(JSONObject("""{"renamed":false,"message":"Enter a race name of up to 80 characters."}"""))
        assertEquals(RaceRenameOutcome.Failed(text.invalid), raceRenameOutcome(result, text))
        val silent = RuntimeResult.Success(JSONObject("""{"renamed":false}"""))
        assertEquals(RaceRenameOutcome.Failed(text.failed), raceRenameOutcome(silent, text))
    }

    @Test
    fun aBridgeFailureSaysOfflineOnlyWhenOffline() {
        assertEquals(RaceRenameOutcome.Failed(text.offline), raceRenameOutcome(RuntimeResult.Failure("x", offline = true), text))
        assertEquals(RaceRenameOutcome.Failed(text.offline), raceRenameOutcome(RuntimeResult.Failure("x", offline = false), text, online = false))
        assertEquals(RaceRenameOutcome.Failed(text.failed), raceRenameOutcome(RuntimeResult.Failure("x", offline = false), text))
    }

    @Test
    fun renamingChangesOnlyThatRaceAndKeepsTheOrder() {
        val after = racesAfterRename(listOf(leadville, hardrock), "a", "Leadville 100")
        assertEquals(listOf("Leadville 100", "Hardrock"), after.map { it.name })
        assertEquals(listOf("a", "c"), after.map { it.id })
    }

    @Test
    fun theTopBarShowsTheActiveRaceOrCrewCue() {
        assertEquals("Hardrock", topBarTitle(listOf(leadville, hardrock), "c"))
        assertEquals("CrewCue", topBarTitle(listOf(leadville), null))
        assertEquals("CrewCue", topBarTitle(listOf(leadville), "gone"))
        assertEquals("CrewCue", topBarTitle(listOf(leadville.copy(name = "  ")), "a"))
    }

    @Test
    fun theCopyCarriesWhoMayRename() {
        val runner = RaceRenameText.from(JSONObject("""{"rowTitle":"Rename race","maxLength":80,"mayRename":true}"""))
        assertTrue(runner.mayRename)
        assertEquals("Rename race", runner.rowTitle)
        assertFalse(RaceRenameText.from(JSONObject("""{"mayRename":false}""")).mayRename)
        assertFalse(RaceRenameText.from(null).mayRename)
    }
}
