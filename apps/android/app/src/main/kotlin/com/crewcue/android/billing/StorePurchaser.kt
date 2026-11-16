package com.crewcue.android.billing

import android.app.Activity
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import org.json.JSONObject

/** Store product ids (#649). They match Google Play, App Store Connect, RevenueCat, and client-core. */
const val PRODUCT_RACE_PASS = "race_pass"
const val PRODUCT_CREW_UPGRADE = "crew_upgrade"
const val PRODUCT_RACE_PASS_FULL_CREW = "race_pass_full_crew"

/** The RevenueCat subscriber attribute the server reads to attach a purchase to a room. */
const val ROOM_ATTRIBUTE = "crewcue_room_id"

/** Shown when the store has no localized price (fake purchaser, store unreachable). Same as client-core. */
fun fallbackPrice(product: String): String = when (product) {
    PRODUCT_RACE_PASS -> "$14.99"
    PRODUCT_CREW_UPGRADE -> "$9.99"
    PRODUCT_RACE_PASS_FULL_CREW -> "$19.99"
    else -> ""
}

/** What the store reported for one attempt. Mapped into client-core's `completePurchase` `store` field. */
sealed interface StoreResult {
    data object Purchased : StoreResult
    data object Cancelled : StoreResult
    data class Failed(val message: String, val offline: Boolean) : StoreResult
}

/** One room's billing from the client-core `billing` op. Every member reads the same thing. */
data class BillingInfo(
    val roomId: String,
    val isPaid: Boolean,
    val isUnlimited: Boolean,
    val crewCount: Int,
    val crewLimit: Int?,
    val hasCrewSeat: Boolean,
    val offers: List<String>,
    val summary: String
) {
    companion object {
        fun from(json: JSONObject): BillingInfo {
            val offers = json.optJSONArray("offers")
            return BillingInfo(
                roomId = json.optText("roomId"),
                isPaid = json.optBoolean("isPaid"),
                isUnlimited = json.optBoolean("isUnlimited"),
                crewCount = json.optInt("crewCount"),
                crewLimit = if (json.has("crewLimit") && !json.isNull("crewLimit")) json.optInt("crewLimit") else null,
                hasCrewSeat = json.optBoolean("hasCrewSeat", true),
                offers = (0 until (offers?.length() ?: 0)).mapNotNull { offers?.optString(it) },
                summary = json.optText("summary")
            )
        }
    }
}

/**
 * client-core's purchase phase: "unlocked" | "pending" | "cancelled" | "failed", plus shared copy.
 * [opened] is Android-only: the Play redeem page opened and nothing has been bought yet.
 */
data class PurchaseOutcome(
    val phase: String,
    val message: String,
    val code: String? = null,
    val billing: BillingInfo? = null
) {
    val offline: Boolean get() = phase == "failed" && code == "offline"

    companion object {
        const val OPENED = "opened"

        fun from(result: RuntimeResult): PurchaseOutcome = when (result) {
            is RuntimeResult.Success -> PurchaseOutcome(
                phase = result.result.optText("phase").ifBlank { "failed" },
                message = result.result.optText("message"),
                code = result.result.optText("code").ifBlank { null },
                billing = result.result.optJSONObject("billing")?.let(BillingInfo::from)
            )
            is RuntimeResult.Failure -> PurchaseOutcome(
                phase = "failed",
                message = result.message,
                code = if (result.offline) "offline" else "bridge"
            )
        }
    }
}

/**
 * The store seam. Release builds use [RevenueCatPurchaser]; debug builds without a RevenueCat key use
 * [FakeStorePurchaser]. Each call runs the store step and one billing read; the caller keeps polling
 * with `completePurchase` when the result is "pending", so the screen can say "Payment received…" first.
 */
interface StorePurchaser {
    /** Localized prices by product id. Missing ids fall back to [fallbackPrice]. */
    suspend fun prices(products: List<String>): Map<String, String>

    suspend fun purchase(activity: Activity, product: String, roomId: String): PurchaseOutcome

    /** Google Play's redeem page (real) or a fake Race Pass redemption (debug). */
    suspend fun redeem(activity: Activity, roomId: String): PurchaseOutcome
}

/** How many billing reads the first call makes before handing the rest of the poll to the screen. */
const val FIRST_POLL_ATTEMPTS = 1
