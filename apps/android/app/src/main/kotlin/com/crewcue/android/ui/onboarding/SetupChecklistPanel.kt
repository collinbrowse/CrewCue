package com.crewcue.android.ui.onboarding

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The setup checklist card on Map (clients/behavior/onboarding-runner-tour.md): "Race setup",
 * "N of 5 done", the next open item, Show all / Show less and Hide. Open, the list scrolls inside
 * [maxHeight] so the top bar stays on a short display. client-core decides every row.
 */
@Composable
fun SetupChecklistPanel(
    checklist: SetupChecklistCard,
    onOpen: (SetupChecklistRow) -> Unit,
    onHide: () -> Unit,
    maxHeight: Dp,
    modifier: Modifier = Modifier
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .testTag(SETUP_CHECKLIST_TAG)
            .animateContentSize(),
        shape = RoundedCornerShape(24.dp),
        color = colors.surfaceContainerLowest.copy(alpha = 0.97f),
        shadowElevation = 6.dp
    ) {
        Column(
            Modifier
                .heightIn(max = maxHeight)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(checklist.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(checklist.summary, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
                TextButton(
                    onClick = { expanded = !expanded },
                    modifier = Modifier.testTag("$SETUP_CHECKLIST_TAG.toggle")
                ) { Text(if (expanded) checklist.showLess else checklist.show) }
                TextButton(onClick = onHide, modifier = Modifier.testTag("$SETUP_CHECKLIST_TAG.hide")) {
                    Text(checklist.hide)
                }
            }
            val rows = if (expanded) checklist.items else listOfNotNull(checklist.nextRow)
            rows.forEach { row -> ChecklistRow(row, onOpen) }
        }
    }
}

@Composable
private fun ChecklistRow(row: SetupChecklistRow, onOpen: (SetupChecklistRow) -> Unit) {
    val colors = MaterialTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button) { onOpen(row) }
            .testTag(row.tag)
            .semantics { contentDescription = if (row.done) "${row.title}, done" else row.title }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            if (row.done) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
            contentDescription = null,
            tint = if (row.done) colors.primary else colors.outline,
            modifier = Modifier.size(22.dp)
        )
        Column(Modifier.weight(1f)) {
            Text(
                row.title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                textDecoration = if (row.done) TextDecoration.LineThrough else null
            )
            if (!row.done) Text(row.detail, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
        }
    }
}
