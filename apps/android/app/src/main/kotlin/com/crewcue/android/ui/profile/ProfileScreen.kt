package com.crewcue.android.ui.profile

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import com.crewcue.android.R
import com.crewcue.android.ui.theme.ProductCard
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
        ProductCard {
            Image(
                painter = painterResource(R.drawable.onboarding_runner),
                contentDescription = "Athlete",
                modifier = Modifier
                    .size(96.dp)
                    .clip(CircleShape)
                    .align(androidx.compose.ui.Alignment.CenterHorizontally),
                contentScale = ContentScale.Crop
            )
            Text(
                "Profile",
                modifier = Modifier.padding(top = 12.dp).align(androidx.compose.ui.Alignment.CenterHorizontally),
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleLarge
            )
            if (model.name.isNotBlank()) {
                Text(
                    model.name,
                    modifier = Modifier.padding(top = 4.dp).align(androidx.compose.ui.Alignment.CenterHorizontally).semantics {
                        contentDescription = model.name
                    }
                )
            }
            val status = model.status
            if (status != null) {
                Text(
                    status,
                    modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = status }
                )
            } else if (model.name.isBlank()) {
                Text(
                    PROFILE_EMPTY,
                    modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = PROFILE_EMPTY }
                )
            }
        }
        if (!roomId.isNullOrBlank()) {
            ProductCard(Modifier.padding(top = 12.dp)) {
                Text("Race & workspace", fontWeight = FontWeight.Bold)
                Text(
                    "Manage members and room controls for your current race.",
                    modifier = Modifier.padding(top = 4.dp)
                )
                Button(
                    onClick = shell::openRoomMembers,
                    modifier = Modifier
                        .padding(top = 10.dp)
                        .fillMaxWidth()
                        .semantics { contentDescription = "Room members" },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        contentColor = MaterialTheme.colorScheme.onSurface
                    )
                ) {
                    Text("Room members")
                }
                Button(
                    onClick = shell::openIncidents,
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .fillMaxWidth()
                        .semantics { contentDescription = "Incidents" },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        contentColor = MaterialTheme.colorScheme.onSurface
                    )
                ) {
                    Text("Incidents")
                }
            }
        }
        ProductCard(Modifier.padding(top = 12.dp)) {
            Text("Training history", fontWeight = FontWeight.Bold)
            Text(
                "Connect Strava so pace can use your recent efforts.",
                modifier = Modifier.padding(top = 4.dp)
            )
            Button(
                onClick = shell::openStrava,
                modifier = Modifier
                    .padding(top = 10.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Strava" },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    contentColor = MaterialTheme.colorScheme.onSurface
                )
            ) {
                Text("Strava")
            }
        }
        ProductCard(Modifier.padding(top = 12.dp)) {
            Text("Account", fontWeight = FontWeight.Bold)
            Text(
                "Sign out of this device and return to the login flow.",
                modifier = Modifier.padding(top = 4.dp)
            )
            Button(
                onClick = { shell.signOut(activity) },
                modifier = Modifier
                    .padding(top = 10.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Sign out" },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError
                )
            ) {
                Text("Sign out")
            }
        }
        Spacer(Modifier.height(12.dp))
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
