package com.crewcue.android.billing

import android.app.Activity
import com.crewcue.android.data.RaceDayBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Debug builds only: client-core's fake store, which posts to `/billing/dev-purchase` (production refuses it).
 * [webhookDelaySeconds] (from `?webhookDelay=` on a dev deeplink) delays the fake webhook to prove the poll.
 */
class FakeStorePurchaser(private val raceDay: RaceDayBridge) : StorePurchaser {
    @Volatile
    var webhookDelaySeconds: Double = 0.0

    override suspend fun prices(products: List<String>): Map<String, String> = emptyMap()

    override suspend fun purchase(activity: Activity, product: String, roomId: String): PurchaseOutcome =
        withContext(Dispatchers.IO) {
            PurchaseOutcome.from(raceDay.fakePurchase(roomId, product, webhookDelaySeconds, FIRST_POLL_ATTEMPTS))
        }

    /** A fake redemption is a fake Race Pass purchase. */
    override suspend fun redeem(activity: Activity, roomId: String): PurchaseOutcome =
        purchase(activity, PRODUCT_RACE_PASS, roomId)
}
