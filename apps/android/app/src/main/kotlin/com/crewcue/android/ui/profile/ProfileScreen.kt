package com.crewcue.android.ui.profile

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

const val PROFILE_EMPTY = "Display name is empty."
const val PROFILE_ERROR = "Couldn't load profile."
const val PROFILE_OFFLINE = "Offline. Profile not updated."

@Composable
fun ProfileScreen(shell: ShellViewModel, modifier: Modifier = Modifier) {
    val session = shell.session
    val model: ProfileViewModel = viewModel(
        key = "profile-${session?.userId}",
        factory = ProfileViewModelFactory(shell.container.raceDay, session?.displayName.orEmpty())
    )
    val context = LocalContext.current
    val activity = context.findActivity()
    LaunchedEffect(session?.userId, session?.roomId, session?.displayName) {
        model.load(
            userId = session?.userId.orEmpty(),
            roomId = session?.roomId,
            sessionName = session?.displayName.orEmpty(),
            online = context.isOnline()
        )
    }
    val roomId = session?.roomId
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.profile")
            .semantics { contentDescription = "Profile" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("Profile")
        if (model.name.isNotBlank()) {
            Text(
                model.name,
                modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.name }
            )
        }
        val status = model.status
        if (status != null) {
            Text(status, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = status })
        } else if (model.name.isBlank()) {
            Text(
                PROFILE_EMPTY,
                modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = PROFILE_EMPTY }
            )
        }
        Button(
            onClick = { shell.signOut(activity) },
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Sign out" }
        ) {
            Text("Sign out")
        }
        Button(
            onClick = shell::openStrava,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Strava" }
        ) {
            Text("Strava")
        }
        if (!roomId.isNullOrBlank()) {
            Button(
                onClick = shell::openRoomMembers,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Room members" }
            ) {
                Text("Room members")
            }
            Button(
                onClick = shell::openIncidents,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Incidents" }
            ) {
                Text("Incidents")
            }
        }
    }
}

class ProfileViewModel(
    private val raceDay: RaceDayBridge,
    initialName: String
) : ViewModel() {
    var name by mutableStateOf(initialName.trim())
        private set
    var status by mutableStateOf(if (initialName.isBlank()) PROFILE_EMPTY else null as String?)
        private set

    private var generation = 0

    fun load(userId: String, roomId: String?, sessionName: String, online: Boolean) {
        val local = sessionName.trim()
        val ticket = ++generation
        if (roomId.isNullOrBlank()) {
            name = local
            status = if (local.isEmpty()) PROFILE_EMPTY else null
            return
        }
        viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) { raceDay.loadRoom(roomId) }
            } catch (_: Throwable) {
                if (ticket != generation) return@launch
                if (name.isBlank()) name = local
                status = if (online) PROFILE_ERROR else PROFILE_OFFLINE
                return@launch
            }
            if (ticket != generation) return@launch
            when (result) {
                is RuntimeResult.Failure -> {
                    if (name.isBlank()) name = local
                    status = if (result.offline || !online) PROFILE_OFFLINE else PROFILE_ERROR
                }
                is RuntimeResult.Success -> applyRoom(result.result, userId, local)
            }
        }
    }

    private fun applyRoom(json: JSONObject, userId: String, local: String) {
        if (json.optBoolean("offline")) {
            if (name.isBlank()) name = local
            status = PROFILE_OFFLINE
            return
        }
        val loaded = memberName(json, userId).ifBlank { local }
        name = loaded
        status = if (loaded.isEmpty()) PROFILE_EMPTY else null
    }

    private fun memberName(json: JSONObject, userId: String): String {
        val rows = json.optJSONArray("memberships") ?: return ""
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            if (row.optString("userId") != userId) continue
            return row.optString("displayName").trim()
        }
        return ""
    }
}

class ProfileViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val initialName: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ProfileViewModel(raceDay, initialName) as T
    }
}
