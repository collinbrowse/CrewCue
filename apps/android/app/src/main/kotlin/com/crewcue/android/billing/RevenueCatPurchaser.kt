package com.crewcue.android.billing

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.logging.AndroidLogger
import com.crewcue.android.session.SessionStore
import com.revenuecat.purchases.ProductType
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import com.revenuecat.purchases.PurchasesErrorCode
import com.revenuecat.purchases.PurchasesException
import com.revenuecat.purchases.PurchasesTransactionException
import com.revenuecat.purchases.awaitGetProducts
import com.revenuecat.purchases.awaitLogIn
import com.revenuecat.purchases.awaitPurchase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * RevenueCat SDK pocket. The only file that imports `com.revenuecat`. The store charges; the server unlocks
 * the room from RevenueCat's webhook, which reads the [ROOM_ATTRIBUTE] attribute set here before buying.
 */
class RevenueCatPurchaser(
    context: Context,
    private val apiKey: String,
    private val raceDay: RaceDayBridge,
    private val sessionStore: SessionStore,
    private val logger: AndroidLogger
) : StorePurchaser {
    private val appContext = context.applicationContext

    /** Signs RevenueCat in as the CrewCue user. Null when this build has no key or nobody is signed in. */
    private suspend fun ready(): Purchases? {
        if (apiKey.isBlank()) return null
        val userId = sessionStore.current()?.userId?.takeIf { it.isNotBlank() } ?: return null
        if (!Purchases.isConfigured) {
            Purchases.configure(PurchasesConfiguration.Builder(appContext, apiKey).appUserID(userId).build())
        } else if (Purchases.sharedInstance.appUserID != userId) {
            Purchases.sharedInstance.awaitLogIn(userId)
        }
        return Purchases.sharedInstance
    }

    override suspend fun prices(products: List<String>): Map<String, String> = try {
        val purchases = ready() ?: return emptyMap()
        purchases.awaitGetProducts(products, ProductType.INAPP).associate { it.id to it.price.formatted }
    } catch (error: Throwable) {
        logger.log("revenuecat prices failed: ${error.message}")
        emptyMap()
    }

    override suspend fun purchase(activity: Activity, product: String, roomId: String): PurchaseOutcome {
        val store = buy(activity, product, roomId)
        return withContext(Dispatchers.IO) { complete(roomId, product, store) }
    }

    private suspend fun buy(activity: Activity, product: String, roomId: String): StoreResult {
        if (apiKey.isBlank()) return StoreResult.Failed(NOT_SET_UP, offline = false)
        return try {
            val purchases = ready() ?: return StoreResult.Failed(NOT_SET_UP, offline = false)
            purchases.setAttributes(mapOf(ROOM_ATTRIBUTE to roomId))
            val storeProduct = purchases.awaitGetProducts(listOf(product), ProductType.INAPP).firstOrNull()
                ?: return StoreResult.Failed(UNAVAILABLE, offline = false)
            purchases.awaitPurchase(PurchaseParams.Builder(activity, storeProduct).build())
            StoreResult.Purchased
        } catch (error: PurchasesTransactionException) {
            if (error.userCancelled) StoreResult.Cancelled else failed(error.code, error.message)
        } catch (error: PurchasesException) {
            failed(error.code, error.message)
        }
    }

    private fun failed(code: PurchasesErrorCode, message: String?): StoreResult {
        logger.log("revenuecat purchase failed: $code $message")
        return when (code) {
            PurchasesErrorCode.PurchaseCancelledError -> StoreResult.Cancelled
            PurchasesErrorCode.NetworkError -> StoreResult.Failed(message.orEmpty(), offline = true)
            else -> StoreResult.Failed(message?.ifBlank { null } ?: COULD_NOT_COMPLETE, offline = false)
        }
    }

    private fun complete(roomId: String, product: String, store: StoreResult) = PurchaseOutcome.from(
        when (store) {
            StoreResult.Purchased -> raceDay.completePurchase(roomId, product, "purchased", pollAttempts = FIRST_POLL_ATTEMPTS)
            StoreResult.Cancelled -> raceDay.completePurchase(roomId, product, "cancelled")
            is StoreResult.Failed -> raceDay.completePurchase(roomId, product, "failed", store.message, store.offline)
        }
    )

    /** Opens Google Play's redeem page. A redeemed code reaches the server as a RevenueCat purchase. */
    override suspend fun redeem(activity: Activity, roomId: String): PurchaseOutcome {
        // The attribute must be on the RevenueCat customer before Play reports the redeemed purchase.
        try {
            ready()?.setAttributes(mapOf(ROOM_ATTRIBUTE to roomId))
        } catch (error: Throwable) {
            logger.log("revenuecat attribute failed: ${error.message}")
        }
        return try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PLAY_REDEEM_URL)))
            PurchaseOutcome(PurchaseOutcome.OPENED, "")
        } catch (_: ActivityNotFoundException) {
            PurchaseOutcome("failed", "", code = "redeem")
        }
    }

    private companion object {
        const val PLAY_REDEEM_URL = "https://play.google.com/redeem?code="
        const val NOT_SET_UP = "Purchases aren't set up in this build."
        const val UNAVAILABLE = "This purchase isn't available right now."
        const val COULD_NOT_COMPLETE = "Couldn't complete the purchase."
    }
}
