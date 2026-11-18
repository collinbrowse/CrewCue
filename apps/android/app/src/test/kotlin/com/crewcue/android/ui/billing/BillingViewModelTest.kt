package com.crewcue.android.ui.billing

import android.app.Activity
import com.crewcue.android.billing.PRODUCT_RACE_PASS
import com.crewcue.android.billing.PurchaseOutcome
import com.crewcue.android.billing.StorePurchaser
import com.crewcue.android.data.RuntimeResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private const val PENDING = "Payment received. Unlocking your race…"

/** client-core's billing reads: the server's answer for the room, unpaid until [paid]. */
private class FakeBillingRuntime : BillingRuntime {
    var paid = false
    var failNextRead = false
    var billingReads = 0
    var polls = 0

    override fun billing(roomId: String): RuntimeResult {
        billingReads += 1
        if (failNextRead) {
            failNextRead = false
            return RuntimeResult.Failure("Request failed", offline = false)
        }
        return RuntimeResult.Success(billing(roomId, paid))
    }

    /** The webhook hasn't landed until [paid]: the poll gives up still pending. */
    override fun completePurchase(roomId: String, product: String, pollAttempts: Int?): RuntimeResult {
        polls += 1
        val answer = if (paid) {
            JSONObject().put("phase", "unlocked").put("message", "Race unlocked.").put("billing", billing(roomId, paid = true))
        } else {
            JSONObject().put("phase", "pending").put("message", PENDING)
        }
        return RuntimeResult.Success(answer)
    }

    private fun billing(roomId: String, paid: Boolean): JSONObject = JSONObject()
        .put("roomId", roomId)
        .put("isPaid", paid)
        .put("isUnlimited", false)
        .put("crewCount", 0)
        .put("hasCrewSeat", true)
        .put("offers", JSONArray())
        .put("summary", if (paid) "Race Pass: you plus 1 crew member." else "This race isn't unlocked yet.")
}

/** The store takes the payment; the server hasn't unlocked the race yet. */
private class PendingStore : StorePurchaser {
    override suspend fun prices(products: List<String>): Map<String, String> = emptyMap()

    override suspend fun purchase(activity: Activity, product: String, roomId: String): PurchaseOutcome =
        PurchaseOutcome("pending", PENDING)

    override suspend fun redeem(activity: Activity, roomId: String): PurchaseOutcome = PurchaseOutcome(PurchaseOutcome.OPENED, "")
}

private val COPY = BillingCopy(
    purchaseError = "Couldn't complete the purchase.",
    purchaseOffline = "Offline.",
    redeemSuccess = "Code redeemed.",
    redeemEmpty = "Redeem your code in Google Play.",
    redeemError = "Couldn't redeem the code.",
    redeemOffline = "Offline."
)

@OptIn(ExperimentalCoroutinesApi::class)
class BillingViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val runtime = FakeBillingRuntime()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun model() = BillingViewModel(runtime, PendingStore(), "room-1", COPY, io = dispatcher)

    @Test
    fun aPaymentStillSettlingSurvivesAnotherCompositionOfThePaywall() = runTest(dispatcher) {
        val model = model()
        // Two NavHost entries draw the paywall at once: one billing read.
        model.open(online = true)
        model.open(online = true)
        runCurrent()
        assertEquals(1, runtime.billingReads)
        assertTrue(model.state is BillingUiState.Empty)
        // The store takes the payment and the automatic poll ends with the server still unpaid.
        model.buy(Activity(), PRODUCT_RACE_PASS, online = true)
        runCurrent()
        assertEquals(BillingUiState.Pending(PENDING), model.state)
        assertFalse(model.busy)
        // A fold or rotation recreates the activity, or Back and the replay bring the paywall back:
        // it still shows the payment settling (Check again, both buy buttons off), read again by nobody.
        model.open(online = true)
        runCurrent()
        assertEquals(BillingUiState.Pending(PENDING), model.state)
        assertEquals(1, runtime.billingReads)
        // Only Check again reads again; the webhook has landed, so the race unlocks.
        runtime.paid = true
        model.checkAgain()
        runCurrent()
        assertEquals(2, runtime.polls)
        assertEquals(true, (model.state as BillingUiState.Success).unlocked)
        assertEquals(true, model.billing?.isPaid)
    }

    @Test
    fun aFailedReadStaysUntilTryAgain() = runTest(dispatcher) {
        val model = model()
        runtime.failNextRead = true
        model.open(online = true)
        runCurrent()
        assertTrue(model.state is BillingUiState.Error)
        // Another composition keeps the error and its Try again.
        model.open(online = true)
        runCurrent()
        assertTrue(model.state is BillingUiState.Error)
        assertEquals(1, runtime.billingReads)
        // Try again reads again.
        model.load(online = true)
        runCurrent()
        assertEquals(2, runtime.billingReads)
        assertTrue(model.state is BillingUiState.Empty)
    }
}
