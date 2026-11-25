package com.crewcue.android.ui.activity

import com.crewcue.android.data.RuntimeResult
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RunRemovalTest {
    private val copy = RunRemovalCopy()

    @Test
    fun removedRunOffersRecalculateOnlyForTheRunnersOwnRace() {
        val removed = RuntimeResult.Success(JSONObject("""{"removed":true,"offline":false}"""))
        assertEquals(
            RemovalOutcome(true, "Run removed. Recalculate your estimate without it?", true),
            RemovalOutcome.of(removed, copy, canRecalculate = true)
        )
        assertEquals(
            RemovalOutcome(true, "Run removed. Your next estimate leaves it out.", false),
            RemovalOutcome.of(removed, copy, canRecalculate = false)
        )
    }

    @Test
    fun failuresKeepTheRunAndSayWhy() {
        val offline = RuntimeResult.Success(
            JSONObject("""{"removed":false,"offline":true,"message":"You're offline. The run was not removed."}""")
        )
        assertEquals(RemovalOutcome(false, "You're offline. The run was not removed.", false), RemovalOutcome.of(offline, copy, true))
        assertEquals(
            RemovalOutcome(false, copy.failureMessage, false),
            RemovalOutcome.of(RuntimeResult.Success(JSONObject("""{"removed":false}""")), copy, true)
        )
        assertEquals(copy.offlineMessage, RemovalOutcome.of(RuntimeResult.Failure("x", offline = true), copy, true).message)
        assertEquals(copy.failureMessage, RemovalOutcome.of(RuntimeResult.Failure("x", offline = false), copy, true).message)
    }

    @Test
    fun copyComesFromClientCoreWithFallbacks() {
        val parsed = RunRemovalCopy.parse(JSONObject("""{"confirmTitle":"Remove it?","confirmButton":""}"""))
        assertEquals("Remove it?", parsed.confirmTitle)
        assertEquals("Remove run", parsed.confirmButton)
        assertEquals("Recalculate", parsed.recalculateButton)
    }

    @Test
    fun onlyTheRunnersOpenRaceRecalculates() {
        assertTrue(recalculatesOwnHistory("room-1", "athlete"))
        assertFalse(recalculatesOwnHistory("room-1", "crew_chief"))
        assertFalse(recalculatesOwnHistory(null, "athlete"))
        assertFalse(recalculatesOwnHistory("", "athlete"))
    }
}
