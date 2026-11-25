package com.crewcue.android.ui.onboarding

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.theme.ProductCard

/** Test tag of the Unlock race banner on Map, Pace, and Chat. */
const val UNLOCK_BANNER_TAG = "crewcue.unlock-race-banner"

/** Test tag of a crew member's locked race (`raceLocked`). */
const val RACE_LOCKED_TAG = "crewcue.race-locked"

/**
 * An unpaid race after setup: Map, Pace, and Chat carry this; it opens the paywall. [expiry] is
 * client-core's "Expires in N days" (`OnboardingCopy.unpaidExpiry`), null without a date.
 */
@Composable
fun UnlockRaceBanner(label: String, onUnlock: () -> Unit, modifier: Modifier = Modifier, expiry: String? = null) {
    if (label.isBlank()) return
    val colors = MaterialTheme.colorScheme
    val description = if (expiry.isNullOrBlank()) label else "$label. $expiry"
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .testTag(UNLOCK_BANNER_TAG)
            .semantics(mergeDescendants = true) { contentDescription = description }
            .clickable(role = Role.Button, onClick = onUnlock),
        shape = CircleShape,
        color = colors.primary,
        contentColor = colors.onPrimary,
        shadowElevation = 4.dp
    ) {
        Row(
            Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Outlined.Lock, contentDescription = null)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label, style = MaterialTheme.typography.labelLarge)
                if (!expiry.isNullOrBlank()) {
                    Text(expiry, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

/** A crew member's race the runner hasn't unlocked: client-core's `reason`, in place of the tab. */
@Composable
fun RaceLockedPane(reason: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag(RACE_LOCKED_TAG)
            .semantics(mergeDescendants = true) { contentDescription = reason }
    ) {
        ProductCard {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(reason, style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}
