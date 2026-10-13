package com.crewcue.android.ui.chat

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
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
import java.util.UUID

@Composable
fun PushRegistrationScreen(
    shell: ShellViewModel,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
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
    LaunchedEffect(Unit) { request() }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.push-registration")
            .semantics { contentDescription = "Push" }
            .padding(16.dp)
    ) {
        Text("Push")
        model.status?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        Button(
            onClick = { request() },
            enabled = !model.busy,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Register" }
        ) {
            Text("Register")
        }
        if (onBack != null) {
            Button(
                onClick = onBack,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Chat" }
            ) {
                Text("Chat")
            }
        }
    }
}

class PushRegistrationViewModel(
    private val raceDay: RaceDayBridge
) : ViewModel() {
    var status by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    fun onPermission(granted: Boolean, context: Context) {
        if (!granted) {
            status = PUSH_ERROR
            return
        }
        viewModelScope.launch {
            busy = true
            try {
                status = register(context)
            } catch (_: Throwable) {
                status = if (context.isOnline()) PUSH_ERROR else PUSH_OFFLINE
            } finally {
                busy = false
            }
        }
    }

    private suspend fun register(context: Context): String {
        val token = withContext(Dispatchers.IO) { firebaseTokenOrNull() }
        if (token.isNullOrBlank()) return PUSH_EMPTY
        val online = context.isOnline()
        val enqueued = withContext(Dispatchers.IO) { raceDay.enqueuePush(deviceId(context), token) }
        val id = when (enqueued) {
            is RuntimeResult.Failure -> return if (enqueued.offline || !online) PUSH_OFFLINE else PUSH_ERROR
            is RuntimeResult.Success -> enqueued.result.optString("id")
        }
        val flushed = withContext(Dispatchers.IO) { raceDay.flushOutbox() }
        return when (flushed) {
            is RuntimeResult.Failure -> if (flushed.offline || !context.isOnline()) PUSH_OFFLINE else PUSH_ERROR
            is RuntimeResult.Success -> {
                val pending = flushed.result.optJSONArray("pending")
                val rejected = flushed.result.optJSONArray("rejected")
                when {
                    !context.isOnline() || pending.containsString(id) -> PUSH_OFFLINE
                    rejected.containsString(id) -> PUSH_ERROR
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

private fun deviceId(context: Context): String {
    val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    if (!androidId.isNullOrBlank()) return androidId
    val prefs = context.getSharedPreferences("crewcue.push", Context.MODE_PRIVATE)
    val existing = prefs.getString("deviceId", null)
    if (!existing.isNullOrBlank()) return existing
    val created = UUID.randomUUID().toString()
    prefs.edit().putString("deviceId", created).apply()
    return created
}

private fun firebaseTokenOrNull(): String? {
    return try {
        val messagingClass = Class.forName("com.google.firebase.messaging.FirebaseMessaging")
        val messaging = messagingClass.getMethod("getInstance").invoke(null) ?: return null
        val task = messagingClass.getMethod("getToken").invoke(messaging) ?: return null
        val tasksClass = Class.forName("com.google.android.gms.tasks.Tasks")
        val taskClass = Class.forName("com.google.android.gms.tasks.Task")
        val result = tasksClass.getMethod("await", taskClass).invoke(null, task)
        (result as? String)?.trim()?.ifBlank { null }
    } catch (_: Throwable) {
        null
    }
}

private fun JSONArray?.containsString(value: String): Boolean {
    if (this == null || value.isBlank()) return false
    for (index in 0 until length()) {
        if (optString(index) == value) return true
    }
    return false
}
