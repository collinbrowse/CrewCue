package com.crewcue.android.ui.billing

import android.app.Activity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.billing.BillingInfo
import com.crewcue.android.billing.PRODUCT_CREW_UPGRADE
import com.crewcue.android.billing.PRODUCT_RACE_PASS
import com.crewcue.android.billing.PRODUCT_RACE_PASS_FULL_CREW
import com.crewcue.android.billing.PurchaseOutcome
import com.crewcue.android.billing.StorePurchaser
import com.crewcue.android.billing.fallbackPrice
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.UserFacingError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Checklist copy that client-core owns but only exposes through its fixture screens
 * (`featureScreen` for billing-purchase / billing-redeem / billing-upgrade).
 */
data class BillingCopy(
    val purchaseError: String,
    val purchaseOffline: String,
    val redeemSuccess: String,
    val redeemEmpty: String,
    val redeemError: String,
    val redeemOffline: String
)

/** Mirrors client-core `FeatureState` plus its purchase phases; every message is shared copy. */
sealed interface BillingUiState {
    val message: String

    data object Loading : BillingUiState {
        override val message: String = ""
    }

    /** Paid. [unlocked] when this screen's purchase or redemption just unlocked the room. */
    data class Success(override val message: String, val unlocked: Boolean) : BillingUiState

    /** Unpaid (paywall) or a cancelled purchase. */
    data class Empty(override val message: String) : BillingUiState

    /** The store took the payment; the server (webhook) has not unlocked the room yet. */
    data class Pending(override val message: String) : BillingUiState

    data class Error(val failure: UserFacingError) : BillingUiState {
        override val message: String get() = failure.message
    }

    data class Offline(val failure: UserFacingError) : BillingUiState {
        override val message: String get() = failure.message
    }
}

/** Which checklist a purchase speaks for: the paywall / upgrade, or code redemption. */
enum class BillingFlowKind { Purchase, Redeem }

class BillingViewModel(
    private val raceDay: RaceDayBridge,
    private val purchaser: StorePurchaser,
    private val roomId: String,
    private val copy: BillingCopy
) : ViewModel() {
    var state by mutableStateOf<BillingUiState>(BillingUiState.Loading)
        private set
    var billing by mutableStateOf<BillingInfo?>(null)
        private set
    /** The product whose store step or poll is running; [PRODUCT_RACE_PASS] for a redemption. */
    var busyProduct by mutableStateOf<String?>(null)
        private set
    var prices by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    private var lastProduct: String? = null
    private var lastKind = BillingFlowKind.Purchase
    private var generation = 0

    val busy: Boolean get() = busyProduct != null

    fun price(product: String): String = prices[product] ?: fallbackPrice(product)

    fun load(online: Boolean) {
        if (busy) return
        val ticket = ++generation
        if (prices.isEmpty()) {
            viewModelScope.launch {
                val loaded = purchaser.prices(listOf(PRODUCT_RACE_PASS, PRODUCT_RACE_PASS_FULL_CREW, PRODUCT_CREW_UPGRADE))
                if (loaded.isNotEmpty()) prices = loaded
            }
        }
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.billing(roomId) }
            if (ticket != generation) return@launch
            when (result) {
                is RuntimeResult.Failure -> state = if (result.offline || !online) {
                    offline(copy.purchaseOffline)
                } else {
                    error(copy.purchaseError)
                }
                is RuntimeResult.Success -> {
                    val info = BillingInfo.from(result.result)
                    billing = info
                    state = if (info.isPaid) {
                        BillingUiState.Success(info.summary, unlocked = false)
                    } else {
                        BillingUiState.Empty(info.summary)
                    }
                }
            }
        }
    }

    fun buy(activity: Activity?, product: String, online: Boolean) {
        start(BillingFlowKind.Purchase, product, online) {
            if (activity == null) PurchaseOutcome("failed", "", code = "activity") else purchaser.purchase(activity, product, roomId)
        }
    }

    fun redeem(activity: Activity?, online: Boolean) {
        start(BillingFlowKind.Redeem, PRODUCT_RACE_PASS, online) {
            if (activity == null) PurchaseOutcome("failed", "", code = "redeem") else purchaser.redeem(activity, roomId)
        }
    }

    /** "Check again" after a pending purchase: read billing until the webhook lands. */
    fun checkAgain() {
        val product = lastProduct ?: return
        if (busy) return
        busyProduct = product
        val ticket = ++generation
        viewModelScope.launch {
            try {
                val outcome = poll(product, attempts = null)
                if (ticket == generation) apply(outcome, lastKind, pollPending = false)
            } finally {
                if (ticket == generation) busyProduct = null
            }
        }
    }

    private fun start(kind: BillingFlowKind, product: String, online: Boolean, store: suspend () -> PurchaseOutcome) {
        if (busy) return
        if (!online) {
            state = offline(if (kind == BillingFlowKind.Redeem) copy.redeemOffline else copy.purchaseOffline)
            return
        }
        lastProduct = product
        lastKind = kind
        busyProduct = product
        val ticket = ++generation
        viewModelScope.launch {
            try {
                val outcome = store()
                if (ticket != generation) return@launch
                if (outcome.phase == PurchaseOutcome.OPENED) {
                    // The Play redeem page is open; a redeemed code shows up as a purchase on the server.
                    state = BillingUiState.Empty(copy.redeemEmpty)
                    val redeemed = poll(product, attempts = REDEEM_POLL_ATTEMPTS)
                    if (ticket == generation) apply(redeemed, kind, pollPending = false)
                    return@launch
                }
                apply(outcome, kind, pollPending = true)
                if (outcome.phase == "pending" && ticket == generation) {
                    val settled = poll(product, attempts = null)
                    if (ticket == generation) apply(settled, kind, pollPending = false)
                }
            } finally {
                if (ticket == generation) busyProduct = null
            }
        }
    }

    private suspend fun poll(product: String, attempts: Int?): PurchaseOutcome = withContext(Dispatchers.IO) {
        PurchaseOutcome.from(raceDay.completePurchase(roomId, product, "purchased", pollAttempts = attempts))
    }

    private fun apply(outcome: PurchaseOutcome, kind: BillingFlowKind, pollPending: Boolean) {
        val redeem = kind == BillingFlowKind.Redeem
        state = when (outcome.phase) {
            "unlocked" -> {
                outcome.billing?.let { billing = it }
                BillingUiState.Success(if (redeem) copy.redeemSuccess else outcome.message, unlocked = true)
            }
            // While the poll keeps going, a redemption reads as redeemed; client-core says "Payment received…".
            "pending" -> BillingUiState.Pending(if (redeem && pollPending) copy.redeemSuccess else outcome.message)
            "cancelled" -> BillingUiState.Empty(outcome.message)
            else -> when {
                outcome.offline -> offline(if (redeem) copy.redeemOffline else outcome.message.ifBlank { copy.purchaseOffline })
                redeem -> error(copy.redeemError)
                // A store-side refusal carries the store's (or this build's) own words.
                outcome.code == "store" && outcome.message.isNotBlank() -> error(outcome.message)
                else -> error(copy.purchaseError)
            }
        }
    }

    private fun offline(message: String) = BillingUiState.Offline(UserFacingError("offline", message, retryable = true))

    private fun error(message: String) = BillingUiState.Error(UserFacingError("error", message, retryable = true))

    private companion object {
        /** About two minutes at client-core's 2 s interval while the user is on the Play redeem page. */
        const val REDEEM_POLL_ATTEMPTS = 60
    }
}

class BillingViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val purchaser: StorePurchaser,
    private val roomId: String,
    private val copy: BillingCopy
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        BillingViewModel(raceDay, purchaser, roomId, copy) as T
}
