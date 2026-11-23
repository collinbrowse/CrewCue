package com.crewcue.android.ui.chat

import androidx.compose.material3.MaterialTheme
import com.crewcue.android.ui.theme.SectionHeader
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.Icon
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Notifications
import com.crewcue.android.ui.theme.PillButton
import com.crewcue.android.ui.theme.SettingRow
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle
import com.crewcue.android.ui.theme.SecondaryButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.map.isOnline
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

/**
 * Device registration for race alerts, shown in the settings sheet.
 * Asks for notification permission on appear only when the push deeplink opened the sheet.
 */
@Composable
fun PushSection(shell: ShellViewModel, requestOnAppear: Boolean, modifier: Modifier = Modifier) {
    val model: PushRegistrationViewModel = viewModel(
        key = "push-${shell.session?.userId}",
        factory = PushRegistrationViewModelFactory(shell.container.raceDay)
    )
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        model.onPermission(granted, context.applicationContext)
    }
    fun request() {
        if (notificationsGranted(context)) {
            model.onPermission(true, context.applicationContext)
        } else {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    LaunchedEffect(requestOnAppear) { if (requestOnAppear) request() }
    LaunchedEffect(Unit) { model.noteAllowed(notificationsGranted(context)) }
    val on = model.enabled && model.status.isNullOrBlank()
    SettingRow(
        Icons.Outlined.Notifications,
        "Race alerts on this phone",
        modifier = modifier
            .testTag("crewcue.push-registration")
            .semantics { contentDescription = "Push" },
        hint = model.status?.takeIf { it.isNotBlank() } ?: if (model.enabled) PUSH_HINT_ON else PUSH_HINT_OFF,
        trailing = {
            if (on) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(" On", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                }
            } else {
                PillButton("Turn on", onClick = { request() }, prominent = true, busy = model.busy, spoken = "Register")
            }
        }
    )
}

class PushRegistrationViewModel(
    private val raceDay: RaceDayBridge
) : ViewModel() {
    var status by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    /** Notifications are allowed and this phone's token reached the server (or is queued). */
    var enabled by mutableStateOf(false)
        private set

    fun noteAllowed(allowed: Boolean) {
        if (status == null) enabled = allowed
    }

    fun onPermission(granted: Boolean, context: Context) {
        if (!granted) {
            enabled = false
            status = PUSH_ERROR
            return
        }
        viewModelScope.launch {
            busy = true
            try {
                val next = register(context)
                enabled = next == PUSH_SUCCESS || next == PUSH_OFFLINE
                status = next.ifBlank { null }
            } catch (_: Throwable) {
                status = if (context.isOnline()) PUSH_FAILED else PUSH_OFFLINE
            } finally {
                busy = false
            }
        }
    }

    private suspend fun register(context: Context): String {
        CrewPush.ensureChannel(context)
        val token = withContext(Dispatchers.IO) { CrewPush.tokenOrNull(context) }
        if (token.isNullOrBlank()) return PUSH_EMPTY
        val online = context.isOnline()
        val enqueued = withContext(Dispatchers.IO) { raceDay.enqueuePush(CrewPush.deviceId(context), token) }
        val id = when (enqueued) {
            is RuntimeResult.Failure -> return if (enqueued.offline || !online) PUSH_OFFLINE else PUSH_FAILED
            is RuntimeResult.Success -> enqueued.result.optString("id")
        }
        val flushed = withContext(Dispatchers.IO) { raceDay.flushOutbox() }
        return when (flushed) {
            is RuntimeResult.Failure -> if (flushed.offline || !context.isOnline()) PUSH_OFFLINE else PUSH_FAILED
            is RuntimeResult.Success -> {
                val pending = flushed.result.optJSONArray("pending")
                val rejected = flushed.result.optJSONArray("rejected")
                when {
                    !context.isOnline() || pending.containsString(id) -> PUSH_OFFLINE
                    rejected.containsString(id) -> PUSH_FAILED
                    else -> PUSH_SUCCESS
                }
            }
        }
    }
}

class PushRegistrationViewModelFactory(
    private val raceDay: RaceDayBridge
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return PushRegistrationViewModel(raceDay) as T
    }
}

private fun notificationsGranted(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 33) return true
    return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
}

private fun JSONArray?.containsString(value: String): Boolean {
    if (this == null || value.isBlank()) return false
    for (index in 0 until length()) {
        if (optString(index) == value) return true
    }
    return false
}
