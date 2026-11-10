package com.crewcue.android.ui.settings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.BuildConfig
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.theme.CrewListRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Copy comes from client-core (`accountDeletionCopy`); these fallbacks only cover a bridge failure. */
data class AccountDeletionCopy(
    val rowTitle: String = "Delete account",
    val confirmTitle: String = "Delete your account?",
    val confirmBody: String = "This permanently deletes your CrewCue account. This can't be undone.",
    val confirmButton: String = "Delete account",
    val cancelButton: String = "Cancel",
    val workingMessage: String = "Deleting your account…",
    val defaultWebURL: String = "https://crewcue.app/delete-account",
    val webLinkLabel: String = "Delete on the web instead"
)

/** What the row does after `deleteAccount` returns. Pure, so it is unit-tested on the JVM. */
sealed interface DeletionOutcome {
    data object Deleted : DeletionOutcome
    data class Failed(val message: String) : DeletionOutcome
}

const val DELETION_OFFLINE = "You're offline. Your account was not deleted."
const val DELETION_FAILED = "Couldn't delete your account. Try again."

/**
 * [deleted]/[message] are the runtime result fields; [failure] is set when the bridge call itself
 * failed. Only a server-confirmed delete signs out; every failure keeps the session for a retry.
 */
fun deletionOutcome(deleted: Boolean?, message: String?, failure: String?, offline: Boolean): DeletionOutcome =
    when {
        deleted == true -> DeletionOutcome.Deleted
        failure != null -> DeletionOutcome.Failed(if (offline) DELETION_OFFLINE else DELETION_FAILED)
        !message.isNullOrBlank() -> DeletionOutcome.Failed(message)
        else -> DeletionOutcome.Failed(DELETION_FAILED)
    }

class AccountDeletionViewModel(private val raceDay: RaceDayBridge) : ViewModel() {
    var copy by mutableStateOf(AccountDeletionCopy())
        private set
    var confirming by mutableStateOf(false)
    var deleting by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)
        private set

    fun loadCopy() {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { raceDay.accountDeletionCopy() }.getOrNull() }
            if (result is RuntimeResult.Success) {
                val json = result.result
                val base = AccountDeletionCopy()
                copy = AccountDeletionCopy(
                    rowTitle = json.optString("rowTitle", base.rowTitle),
                    confirmTitle = json.optString("confirmTitle", base.confirmTitle),
                    confirmBody = json.optString("confirmBody", base.confirmBody),
                    confirmButton = json.optString("confirmButton", base.confirmButton),
                    cancelButton = json.optString("cancelButton", base.cancelButton),
                    workingMessage = json.optString("workingMessage", base.workingMessage),
                    defaultWebURL = json.optString("defaultWebURL", base.defaultWebURL),
                    webLinkLabel = json.optString("webLinkLabel", base.webLinkLabel)
                )
            }
        }
    }

    fun delete(online: Boolean, onDeleted: () -> Unit) {
        if (deleting) return
        confirming = false
        deleting = true
        message = copy.workingMessage
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { raceDay.deleteAccount() }.getOrElse { RuntimeResult.Failure("Request failed", offline = !online) }
            }
            val outcome = when (result) {
                is RuntimeResult.Success -> deletionOutcome(
                    deleted = result.result.optBoolean("deleted"),
                    message = result.result.optString("message").takeIf { it.isNotBlank() },
                    failure = null,
                    offline = false
                )
                is RuntimeResult.Failure -> deletionOutcome(
                    deleted = null,
                    message = null,
                    failure = result.message,
                    offline = result.offline || !online
                )
            }
            deleting = false
            when (outcome) {
                DeletionOutcome.Deleted -> {
                    message = null
                    onDeleted()
                }
                is DeletionOutcome.Failed -> message = outcome.message
            }
        }
    }
}

class AccountDeletionViewModelFactory(private val raceDay: RaceDayBridge) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = AccountDeletionViewModel(raceDay) as T
}

/** Settings → Account → Delete account, with a confirm dialog (#560, Google Play account deletion). */
@Composable
fun DeleteAccountRow(shell: ShellViewModel, onDeleted: () -> Unit) {
    val model: AccountDeletionViewModel = viewModel(
        key = "account-deletion-${shell.session?.userId}",
        factory = AccountDeletionViewModelFactory(shell.container.raceDay)
    )
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    LaunchedEffect(Unit) { model.loadCopy() }
    val copy = model.copy
    Box(
        Modifier
            .testTag("crewcue.account-deletion")
            .semantics { contentDescription = copy.rowTitle }
    ) {
        CrewListRow(
            Icons.Outlined.Delete,
            copy.rowTitle,
            onClick = { if (!model.deleting) model.confirming = true },
            tint = MaterialTheme.colorScheme.error,
            titleColor = MaterialTheme.colorScheme.error
        )
    }
    model.message?.let { line ->
        Text(
            line,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line }
        )
    }
    val webUrl = BuildConfig.ACCOUNT_DELETION_URL.takeIf { it.startsWith("https://") } ?: copy.defaultWebURL
    TextButton(onClick = { runCatching { uriHandler.openUri(webUrl) } }) {
        Text(copy.webLinkLabel, style = MaterialTheme.typography.bodySmall)
    }
    if (model.confirming) {
        AlertDialog(
            onDismissRequest = { model.confirming = false },
            title = { Text(copy.confirmTitle) },
            text = { Text(copy.confirmBody) },
            confirmButton = {
                TextButton(onClick = { model.delete(context.isOnline(), onDeleted) }) {
                    Text(copy.confirmButton, color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { model.confirming = false }) { Text(copy.cancelButton) }
            }
        )
    }
}
