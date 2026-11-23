package com.crewcue.android.ui.chat

import com.crewcue.android.ui.theme.SectionHeader
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import com.crewcue.android.ui.theme.SettingRow
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle
import com.crewcue.android.ui.theme.SecondaryButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.ShellViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Chat alert preference for the current room, shown in the settings sheet. */
@Composable
fun ChatAlertsSection(shell: ShellViewModel, roomId: String, modifier: Modifier = Modifier) {
    val model: ChatPrefsViewModel = viewModel(
        key = "chat-prefs-$roomId",
        factory = ChatPrefsViewModelFactory(shell.container.raceDay, roomId)
    )
    LaunchedEffect(roomId) { model.load() }
    val options = listOf("all" to "All", "mentions" to "Mentions", "none" to "Off")
    SettingRow(
        Icons.AutoMirrored.Outlined.Chat,
        "Crew chat",
        modifier = modifier
            .testTag("crewcue.chat-notification-prefs")
            .semantics { contentDescription = "Chat alerts" },
        hint = model.status,
        below = {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                options.forEachIndexed { index, (value, label) ->
                    val selected = model.preference == value
                    SegmentedButton(
                        selected = selected,
                        onClick = { model.select(value) },
                        enabled = !model.busy,
                        shape = SegmentedButtonDefaults.itemShape(index, options.size),
                        modifier = Modifier.semantics { contentDescription = if (selected) "$label selected" else label }
                    ) { Text(label) }
                }
            }
        }
    )
}

class ChatPrefsViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModel() {
    var preference by mutableStateOf("")
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    fun load() {
        viewModelScope.launch { apply(read()) }
    }

    fun select(next: String) {
        preference = next
        viewModelScope.launch {
            busy = true
            try {
                apply(save(next))
            } finally {
                busy = false
            }
        }
    }

    private suspend fun read(): RuntimeResult = try {
        withContext(Dispatchers.IO) { raceDay.notificationPreference(roomId) }
    } catch (_: Throwable) {
        RuntimeResult.Failure(PREFS_ERROR, offline = false)
    }

    private suspend fun save(next: String): RuntimeResult = try {
        withContext(Dispatchers.IO) { raceDay.saveNotificationPreference(roomId, next) }
    } catch (_: Throwable) {
        RuntimeResult.Failure(PREFS_ERROR, offline = false)
    }

    private fun apply(result: RuntimeResult) {
        when (result) {
            is RuntimeResult.Failure -> status = if (result.offline) PREFS_OFFLINE else PREFS_ERROR
            is RuntimeResult.Success -> {
                val saved = result.result.optString("preference")
                if (saved.isNotBlank()) preference = saved
                status = when {
                    result.result.optBoolean("offline") -> PREFS_OFFLINE
                    preference == "none" -> PREFS_EMPTY
                    preference == "mentions" -> PREFS_SUCCESS
                    preference == "all" -> PREFS_ALL
                    else -> PREFS_ERROR
                }
            }
        }
    }
}

class ChatPrefsViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ChatPrefsViewModel(raceDay, roomId) as T
    }
}
