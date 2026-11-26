package com.crewcue.android.ui.activity

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.theme.PillButton
import org.json.JSONObject

/** Copy comes from client-core (`activityDeleteCopy`); these fallbacks only cover a bridge failure. */
data class RunRemovalCopy(
    val actionTitle: String = "Remove",
    val confirmTitle: String = "Remove this run?",
    val confirmBody: String = "It will no longer shape your pace estimate. You can import the file again later.",
    val confirmButton: String = "Remove run",
    val cancelButton: String = "Cancel",
    val removedMessage: String = "Run removed. Your next estimate leaves it out.",
    val recalculatePrompt: String = "Run removed. Recalculate your estimate without it?",
    val recalculateButton: String = "Recalculate",
    val recalculatedMessage: String = "Estimate recalculated. Open Pace to see it.",
    val recalculateFailedMessage: String = "Couldn't recalculate the estimate. Try again.",
    val offlineMessage: String = "You're offline. The run was not removed.",
    val failureMessage: String = "Couldn't remove the run. Try again."
) {
    companion object {
        fun parse(json: JSONObject): RunRemovalCopy {
            val base = RunRemovalCopy()
            fun pick(key: String, fallback: String) = json.optString(key).ifBlank { fallback }
            return RunRemovalCopy(
                actionTitle = pick("actionTitle", base.actionTitle),
                confirmTitle = pick("confirmTitle", base.confirmTitle),
                confirmBody = pick("confirmBody", base.confirmBody),
                confirmButton = pick("confirmButton", base.confirmButton),
                cancelButton = pick("cancelButton", base.cancelButton),
                removedMessage = pick("removedMessage", base.removedMessage),
                recalculatePrompt = pick("recalculatePrompt", base.recalculatePrompt),
                recalculateButton = pick("recalculateButton", base.recalculateButton),
                recalculatedMessage = pick("recalculatedMessage", base.recalculatedMessage),
                recalculateFailedMessage = pick("recalculateFailedMessage", base.recalculateFailedMessage),
                offlineMessage = pick("offlineMessage", base.offlineMessage),
                failureMessage = pick("failureMessage", base.failureMessage)
            )
        }
    }
}

/** What the runs sheet shows after `deleteActivity` returns. Pure, so it is unit-tested on the JVM. */
data class RemovalOutcome(val removed: Boolean, val message: String, val offersRecalculate: Boolean) {
    companion object {
        /** [canRecalculate]: the open race is the signed-in runner's own, so its estimate reads these runs. */
        fun of(result: RuntimeResult, copy: RunRemovalCopy, canRecalculate: Boolean): RemovalOutcome = when (result) {
            is RuntimeResult.Failure ->
                RemovalOutcome(false, if (result.offline) copy.offlineMessage else copy.failureMessage, false)
            is RuntimeResult.Success -> if (result.result.optBoolean("removed")) {
                RemovalOutcome(true, if (canRecalculate) copy.recalculatePrompt else copy.removedMessage, canRecalculate)
            } else {
                val fallback = if (result.result.optBoolean("offline")) copy.offlineMessage else copy.failureMessage
                RemovalOutcome(false, result.result.optString("message").ifBlank { fallback }, false)
            }
        }
    }
}

/** Only the runner's own race reads these runs; a crew role's race reads someone else's. */
fun recalculatesOwnHistory(roomId: String?, role: String?): Boolean = !roomId.isNullOrBlank() && role == "athlete"

/**
 * One imported run that swipes left to Remove. The swipe never dismisses the row by itself: it
 * asks for the confirm, and the row leaves only when the server has removed the run. TalkBack gets
 * the same Remove as a custom action.
 */
@Composable
fun RemovableRunRow(
    item: ImportedRun,
    copy: RunRemovalCopy,
    removing: Boolean,
    onRemove: (ImportedRun) -> Unit,
    content: @Composable () -> Unit
) {
    val state = rememberSwipeToDismissBoxState()
    val scope = rememberCoroutineScope()
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        gesturesEnabled = !removing,
        onDismiss = { value ->
            // Snap back at once: the row leaves only after the confirm and the server's removal.
            scope.launch { state.reset() }
            if (value == SwipeToDismissBoxValue.EndToStart) onRemove(item)
        },
        modifier = Modifier
            .testTag("crewcue.activity-import.run")
            .semantics {
                customActions = listOf(CustomAccessibilityAction(copy.actionTitle) { onRemove(item); true })
            },
        backgroundContent = {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.error)
                    .padding(horizontal = 20.dp)
                    .testTag("crewcue.activity-import.remove"),
                contentAlignment = Alignment.CenterEnd
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.onError)
                    Text(copy.actionTitle, color = MaterialTheme.colorScheme.onError, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    ) {
        Box(
            Modifier
                .background(MaterialTheme.colorScheme.surfaceContainerLowest)
                .alpha(if (removing) 0.4f else 1f)
        ) { content() }
    }
}

@Composable
fun RemoveRunDialog(copy: RunRemovalCopy, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        // A dialog is its own window: export its tags as resource ids for UI automation.
        modifier = Modifier.semantics { testTagsAsResourceId = true }.testTag("crewcue.activity-import.remove-dialog"),
        title = { Text(copy.confirmTitle) },
        text = { Text(copy.confirmBody) },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag("crewcue.activity-import.remove-confirm")) {
                Text(copy.confirmButton, color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(copy.cancelButton) }
        }
    )
}

/** After a removal: what happened, and Recalculate when the open race reads these runs. */
@Composable
fun RemovalStatus(message: String, offersRecalculate: Boolean, recalculating: Boolean, copy: RunRemovalCopy, onRecalculate: () -> Unit) {
    Column(Modifier.padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.testTag("crewcue.activity-import.removal-status")
        )
        if (offersRecalculate) {
            PillButton(
                copy.recalculateButton,
                onClick = onRecalculate,
                prominent = true,
                busy = recalculating,
                modifier = Modifier.testTag("crewcue.activity-import.recalculate")
            )
        }
    }
}
