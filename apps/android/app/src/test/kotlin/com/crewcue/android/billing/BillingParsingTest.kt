package com.crewcue.android.billing

import com.crewcue.android.data.RuntimeResult
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BillingParsingTest {
    @Test
    fun parsesAFullRacePassRoom() {
        val info = BillingInfo.from(
            JSONObject(
                """{"roomId":"r1","isPaid":true,"isUnlimited":false,"crewCount":1,"crewLimit":1,
                "hasCrewSeat":false,"offers":["crew_upgrade"],
                "summary":"Race Pass: you plus 1 crew member (1 of 1 joined)."}"""
            )
        )
        assertEquals("r1", info.roomId)
        assertTrue(info.isPaid)
        assertFalse(info.isUnlimited)
        assertEquals(1, info.crewLimit)
        assertFalse(info.hasCrewSeat)
        assertEquals(listOf(PRODUCT_CREW_UPGRADE), info.offers)
        assertEquals("Race Pass: you plus 1 crew member (1 of 1 joined).", info.summary)
    }

    @Test
    fun unlimitedRoomHasNoCrewLimit() {
        val info = BillingInfo.from(
            JSONObject("""{"roomId":"r1","isPaid":true,"isUnlimited":true,"crewCount":4,"hasCrewSeat":true,"offers":[],"summary":"Full Crew: unlimited crew."}""")
        )
        assertNull(info.crewLimit)
        assertTrue(info.offers.isEmpty())
    }

    @Test
    fun unlockedOutcomeCarriesBilling() {
        val outcome = PurchaseOutcome.from(
            RuntimeResult.Success(
                JSONObject(
                    """{"phase":"unlocked","message":"Unlocked: you plus 1 crew member.",
                    "billing":{"roomId":"r1","isPaid":true,"isUnlimited":false,"crewCount":0,"crewLimit":1,
                    "hasCrewSeat":true,"offers":["crew_upgrade"],"summary":"x"}}"""
                )
            )
        )
        assertEquals("unlocked", outcome.phase)
        assertEquals("Unlocked: you plus 1 crew member.", outcome.message)
        assertTrue(outcome.billing?.isPaid == true)
        assertFalse(outcome.offline)
    }

    @Test
    fun offlineFailedPhaseIsOffline() {
        val outcome = PurchaseOutcome.from(
            RuntimeResult.Success(JSONObject("""{"phase":"failed","code":"offline","message":"Offline. Purchases need the network."}"""))
        )
        assertTrue(outcome.offline)
    }

    @Test
    fun bridgeFailureMapsOfflineFlag() {
        assertTrue(PurchaseOutcome.from(RuntimeResult.Failure("no route", offline = true)).offline)
        val other = PurchaseOutcome.from(RuntimeResult.Failure("Forbidden", offline = false))
        assertEquals("failed", other.phase)
        assertFalse(other.offline)
    }

    @Test
    fun fallbackPricesMatchClientCore() {
        assertEquals("$14.99", fallbackPrice(PRODUCT_RACE_PASS))
        assertEquals("$9.99", fallbackPrice(PRODUCT_CREW_UPGRADE))
        assertEquals("$19.99", fallbackPrice(PRODUCT_RACE_PASS_FULL_CREW))
    }
}
