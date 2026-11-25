package com.crewcue.android.ui.theme

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The top bar's course strip on Map and Pace. Its numbers are client-core's readout from the
 * runner's pings (`courseStripLabel`, "12.4 of 31.0 mi"), the same on every crew phone.
 */
data class CourseStripState(val fraction: Float, val label: String, val spoken: String)

/** A thin bar and "12.4 of 31.0 mi". The text wraps at large font scales; it never truncates. */
@Composable
fun CourseProgressStrip(state: CourseStripState, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .testTag("crewcue.course-strip")
            .clearAndSetSemantics { contentDescription = state.spoken },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CrewProgressBar(state.fraction, Modifier.weight(1f), height = 4.dp)
        Text(
            state.label,
            style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            softWrap = true,
            overflow = TextOverflow.Clip
        )
    }
}
