package com.crewcue.android.ui.chat

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

@Composable
fun ChatPrefsScreen(
    shell: ShellViewModel,
    roomId: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val model: ChatPrefsViewModel = viewModel(
        key = "chat-prefs-$roomId",
        factory = ChatPrefsViewModelFactory(shell.container.raceDay, roomId)
    )
    LaunchedEffect(roomId) { model.load() }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.chat-notification-prefs")
            .semantics { contentDescription = "Chat alerts" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        ProductTitle("Chat alerts", "Choose what reaches you from this room.")
        model.status?.let { line ->
            Text(line, modifier = Modifier.padding(top = 12.dp).semantics { contentDescription = line })
        }
        ProductCard(Modifier.padding(top = 16.dp)) {
            PreferenceButton("All", "all", model)
            PreferenceButton("Mentions", "mentions", model)
            PreferenceButton("None", "none", model)
        }
        if (onBack != null) {
            SecondaryButton("Chat", onClick = onBack, modifier = Modifier.padding(top = 12.dp))
        }
    }
}

@Composable
private fun PreferenceButton(label: String, preference: String, model: ChatPrefsViewModel) {
    val selected = model.preference == preference
    Button(
        onClick = { model.select(preference) },
        enabled = !model.busy,
        modifier = Modifier
            .padding(top = 8.dp)
            .fillMaxWidth()
            .semantics { contentDescription = if (selected) "$label selected" else label },
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.surfaceContainerHigh
            },
            contentColor = if (selected) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            }
        )
    ) {
        Text(label)
    }
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
                    preference == "all" || preference == "mentions" -> PREFS_SUCCESS
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
