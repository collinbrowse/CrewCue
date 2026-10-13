package com.crewcue.android.ui.strava

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.findActivity
import com.crewcue.android.ui.map.isOnline
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

const val STRAVA_EMPTY = "Strava is not connected."
const val STRAVA_ERROR = "Strava connection failed."
const val STRAVA_OFFLINE = "Offline. Can't reach Strava."

@Composable
fun StravaScreen(
    shell: ShellViewModel,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val model: StravaViewModel = viewModel(
        key = "strava-${shell.session?.userId}",
        factory = StravaViewModelFactory(shell.container.raceDay)
    )
    val context = LocalContext.current
    LaunchedEffect(shell.stravaSignal.id, shell.stravaSignal.failed) {
        model.refresh(context.isOnline(), shell.stravaSignal.failed)
    }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.strava")
            .semantics { contentDescription = "Strava" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("Strava")
        if (model.connected) {
            val line = if (model.athleteId.isNullOrBlank()) "Connected" else "Connected ${model.athleteId}"
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
            model.athleteId?.let { athleteId ->
                Text(
                    athleteId,
                    modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = athleteId }
                )
            }
        }
        model.status?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        Button(
            onClick = { model.connect(context) },
            enabled = !model.busy,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Connect" }
        ) {
            Text("Connect")
        }
        Button(
            onClick = { model.disconnect(context.isOnline()) },
            enabled = !model.busy,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Disconnect" }
        ) {
            Text("Disconnect")
        }
        if (onBack != null) {
            Button(
                onClick = onBack,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Profile" }
            ) {
                Text("Profile")
            }
        }
    }
}

class StravaViewModel(
    private val raceDay: RaceDayBridge
) : ViewModel() {
    var connected by mutableStateOf(false)
        private set
    var athleteId by mutableStateOf<String?>(null)
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    private var generation = 0

    fun refresh(online: Boolean, returnFailed: Boolean) {
        val ticket = ++generation
        viewModelScope.launch {
            val result = read()
            if (ticket != generation) return@launch
            apply(result, online, returnFailed)
        }
    }

    fun connect(context: Context) {
        if (busy) return
        viewModelScope.launch {
            busy = true
            val ticket = ++generation
            try {
                val online = context.isOnline()
                val result = try {
                    withContext(Dispatchers.IO) { raceDay.stravaStart() }
                } catch (_: Throwable) {
                    if (ticket == generation) {
                        connected = false
                        athleteId = null
                        status = if (online) STRAVA_ERROR else STRAVA_OFFLINE
                    }
                    return@launch
                }
                if (ticket != generation) return@launch
                when (result) {
                    is RuntimeResult.Failure -> {
                        connected = false
                        athleteId = null
                        status = if (result.offline || !online) STRAVA_OFFLINE else STRAVA_ERROR
                    }
                    is RuntimeResult.Success -> openAuthorize(context, result.result)
                }
            } finally {
                busy = false
            }
        }
    }

    fun disconnect(online: Boolean) {
        if (busy) return
        viewModelScope.launch {
            busy = true
            val ticket = ++generation
            try {
                val result = try {
                    withContext(Dispatchers.IO) { raceDay.stravaDisconnect() }
                } catch (_: Throwable) {
                    if (ticket == generation) status = if (online) STRAVA_ERROR else STRAVA_OFFLINE
                    return@launch
                }
                if (ticket != generation) return@launch
                when (result) {
                    is RuntimeResult.Failure -> status = if (result.offline || !online) STRAVA_OFFLINE else STRAVA_ERROR
                    is RuntimeResult.Success -> {
                        if (result.result.optBoolean("offline")) {
                            status = STRAVA_OFFLINE
                        } else {
                            connected = false
                            athleteId = null
                            status = STRAVA_EMPTY
                        }
                    }
                }
            } finally {
                busy = false
            }
        }
    }

    private fun openAuthorize(context: Context, json: JSONObject) {
        if (json.optBoolean("offline")) {
            connected = false
            athleteId = null
            status = STRAVA_OFFLINE
            return
        }
        val url = json.optString("authorizeUrl").trim()
        if (url.isEmpty() || !launch(context, url)) {
            status = STRAVA_ERROR
        }
    }

    private fun launch(context: Context, url: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        val activity = context.findActivity()
        return try {
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: Throwable) {
            false
        }
    }

    private suspend fun read(): RuntimeResult = try {
        withContext(Dispatchers.IO) { raceDay.stravaConnection() }
    } catch (_: Throwable) {
        RuntimeResult.Failure(STRAVA_ERROR, offline = false)
    }

    private fun apply(result: RuntimeResult, online: Boolean, returnFailed: Boolean) {
        when (result) {
            is RuntimeResult.Failure -> {
                connected = false
                athleteId = null
                status = if (result.offline || !online) STRAVA_OFFLINE else STRAVA_ERROR
            }
            is RuntimeResult.Success -> {
                val json = result.result
                if (json.optBoolean("offline")) {
                    connected = false
                    athleteId = null
                    status = STRAVA_OFFLINE
                    return
                }
                val isConnected = json.optBoolean("connected")
                val athlete = json.optString("athleteId").trim().ifBlank { null }
                if (isConnected) {
                    connected = true
                    athleteId = athlete
                    status = null
                } else {
                    connected = false
                    athleteId = null
                    status = if (returnFailed) STRAVA_ERROR else STRAVA_EMPTY
                }
            }
        }
    }
}

class StravaViewModelFactory(
    private val raceDay: RaceDayBridge
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return StravaViewModel(raceDay) as T
    }
}
