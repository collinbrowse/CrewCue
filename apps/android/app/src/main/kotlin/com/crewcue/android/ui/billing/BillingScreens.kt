package com.crewcue.android.ui.billing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.billing.PRODUCT_CREW_UPGRADE
import com.crewcue.android.billing.PRODUCT_RACE_PASS
import com.crewcue.android.billing.PRODUCT_RACE_PASS_FULL_CREW
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.findActivity
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle
import com.crewcue.android.ui.theme.SecondaryButton

/** Runner's own copy for a full Race Pass room (client-core `BillingErrors.crewLimitForRunner`). */
const val RUNNER_CREW_FULL = "Your Race Pass covers 1 crew member. Add Full Crew for unlimited crew."

@Composable
private fun rememberBillingModel(shell: ShellViewModel, roomId: String, key: String): BillingViewModel {
    val copy = remember(shell) { shell.billingCopy() }
    return viewModel(
        key = "$key-$roomId",
        factory = BillingViewModelFactory(shell.container.raceDay, shell.container.storePurchaser, roomId, copy)
    )
}

@Composable
private fun StatusLine(state: BillingUiState, tag: String) {
    val message = state.message
    if (message.isBlank()) return
    val error = state is BillingUiState.Error || state is BillingUiState.Offline
    Text(
        message,
        modifier = Modifier
            .padding(top = 12.dp)
            .testTag(tag)
            .semantics { contentDescription = message },
        style = MaterialTheme.typography.bodyLarge,
        fontWeight = if (state is BillingUiState.Success) FontWeight.SemiBold else FontWeight.Normal,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    )
}

/**
 * Paywall (clients/behavior/billing-purchase.md): an unpaid race, right after the runner creates it or
 * whenever the active room is unpaid. Only the runner buys; crew see the room's billing line.
 */
@Composable
fun PaywallScreen(shell: ShellViewModel, roomId: String, onContinue: () -> Unit, modifier: Modifier = Modifier) {
    val model = rememberBillingModel(shell, roomId, "billing-purchase")
    val context = LocalContext.current
    val activity = context.findActivity()
    LaunchedEffect(roomId) { model.load(context.isOnline()) }
    val state = model.state
    val runner = shell.session?.role == "athlete" || shell.races.firstOrNull { it.id == roomId }?.role == "athlete"
    val unlocked = (state as? BillingUiState.Success)?.unlocked == true || model.billing?.isPaid == true
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.billing-purchase")
            .semantics { contentDescription = "Race Pass" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        ProductTitle("Race Pass", "One purchase per race. Your crew joins free.")
        StatusLine(state, "crewcue.billing-purchase.status")
        if (unlocked) {
            PrimaryButton(
                "Continue to race",
                onClick = onContinue,
                modifier = Modifier.padding(top = 16.dp).testTag("crewcue.billing-purchase.continue")
            )
            return@Column
        }
        if (runner) {
            OfferCard(
                title = "Race Pass",
                detail = "You plus 1 crew member for this race.",
                button = "Buy Race Pass · ${model.price(PRODUCT_RACE_PASS)}",
                tag = "crewcue.billing-purchase.buy-pass",
                busy = model.busyProduct == PRODUCT_RACE_PASS,
                enabled = !model.busy,
                onClick = { model.buy(activity, PRODUCT_RACE_PASS, context.isOnline()) }
            )
            OfferCard(
                title = "Race Pass + Full Crew",
                detail = "You plus unlimited crew for this race.",
                button = "Buy with Full Crew · ${model.price(PRODUCT_RACE_PASS_FULL_CREW)}",
                tag = "crewcue.billing-purchase.buy-full-crew",
                busy = model.busyProduct == PRODUCT_RACE_PASS_FULL_CREW,
                enabled = !model.busy,
                onClick = { model.buy(activity, PRODUCT_RACE_PASS_FULL_CREW, context.isOnline()) }
            )
            BillingActions(model, redeemEnabled = true, onRedeem = { model.redeem(activity, context.isOnline()) })
        } else {
            BillingActions(model, redeemEnabled = false, onRedeem = {})
        }
    }
}

@Composable
private fun OfferCard(
    title: String,
    detail: String,
    button: String,
    tag: String,
    busy: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    ProductCard(Modifier.padding(top = 16.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(
            detail,
            modifier = Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        PrimaryButton(button, onClick = onClick, modifier = Modifier.padding(top = 12.dp).testTag(tag), enabled = enabled, busy = busy)
    }
}

/** "Check again" while pending (or after a failed load), and "Redeem code" for the runner. */
@Composable
private fun BillingActions(model: BillingViewModel, redeemEnabled: Boolean, onRedeem: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when (model.state) {
            is BillingUiState.Pending -> SecondaryButton(
                "Check again",
                onClick = model::checkAgain,
                enabled = !model.busy,
                busy = model.busy
            )
            is BillingUiState.Error, is BillingUiState.Offline -> SecondaryButton(
                "Try again",
                onClick = { model.load(context.isOnline()) },
                enabled = !model.busy
            )
            else -> Unit
        }
        if (redeemEnabled) {
            SecondaryButton(
                "Redeem code",
                onClick = onRedeem,
                modifier = Modifier.testTag("crewcue.billing-redeem.open"),
                enabled = !model.busy
            )
        }
    }
}

/** Code redemption (clients/behavior/billing-redeem.md): Google Play's redeem page, never a typed CrewCue code. */
@Composable
fun RedeemScreen(shell: ShellViewModel, roomId: String, onContinue: () -> Unit, modifier: Modifier = Modifier) {
    val model = rememberBillingModel(shell, roomId, "billing-redeem")
    val context = LocalContext.current
    val activity = context.findActivity()
    val copy = remember(shell) { shell.billingCopy() }
    val state = model.state
    val shown = if (state is BillingUiState.Loading) BillingUiState.Empty(copy.redeemEmpty) else state
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.billing-redeem")
            .semantics { contentDescription = "Redeem code" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        ProductTitle("Redeem code", "")
        StatusLine(shown, "crewcue.billing-redeem.status")
        if ((state as? BillingUiState.Success)?.unlocked == true) {
            PrimaryButton(
                "Continue to race",
                onClick = onContinue,
                modifier = Modifier.padding(top = 16.dp).testTag("crewcue.billing-purchase.continue")
            )
            return@Column
        }
        PrimaryButton(
            "Redeem code",
            onClick = { model.redeem(activity, context.isOnline()) },
            modifier = Modifier.padding(top = 16.dp).testTag("crewcue.billing-redeem.open"),
            enabled = !model.busy,
            busy = model.busy
        )
        if (state is BillingUiState.Pending) {
            SecondaryButton("Check again", onClick = model::checkAgain, modifier = Modifier.padding(top = 10.dp), enabled = !model.busy)
        }
    }
}

/**
 * Full Crew upgrade (clients/behavior/billing-upgrade.md) on the Room members screen. Every member sees the
 * room's billing line; the runner of a Race Pass room also gets the upgrade button.
 */
@Composable
fun UpgradeCard(shell: ShellViewModel, roomId: String, isRunner: Boolean, modifier: Modifier = Modifier) {
    val model = rememberBillingModel(shell, roomId, "billing-upgrade")
    val context = LocalContext.current
    val activity = context.findActivity()
    LaunchedEffect(roomId) { model.load(context.isOnline()) }
    val billing = model.billing
    val state = model.state
    ProductCard(
        modifier
            .testTag("crewcue.billing-upgrade")
            .semantics(mergeDescendants = false) { contentDescription = "Full Crew" }
    ) {
        Text("Race Pass", style = MaterialTheme.typography.titleMedium)
        StatusLine(state, "crewcue.billing-upgrade.status")
        val full = billing != null && billing.isPaid && !billing.isUnlimited && !billing.hasCrewSeat
        val justUnlocked = (state as? BillingUiState.Success)?.unlocked == true
        if (isRunner && full && !justUnlocked) {
            Text(
                RUNNER_CREW_FULL,
                modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = RUNNER_CREW_FULL },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (isRunner && billing?.offers?.contains(PRODUCT_CREW_UPGRADE) == true) {
            PrimaryButton(
                "Add Full Crew · ${model.price(PRODUCT_CREW_UPGRADE)}",
                onClick = { model.buy(activity, PRODUCT_CREW_UPGRADE, context.isOnline()) },
                modifier = Modifier.padding(top = 12.dp).testTag("crewcue.billing-upgrade.buy"),
                enabled = !model.busy,
                busy = model.busy
            )
        }
        if (state is BillingUiState.Pending) {
            SecondaryButton("Check again", onClick = model::checkAgain, modifier = Modifier.padding(top = 10.dp), enabled = !model.busy)
        }
    }
}
