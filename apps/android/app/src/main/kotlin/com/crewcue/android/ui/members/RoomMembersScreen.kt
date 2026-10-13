package com.crewcue.android.ui.members

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
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
import com.crewcue.android.ui.map.isOnline
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

const val MEMBERS_EMPTY = "No members yet."
const val MEMBERS_ERROR = "Couldn't update members."
const val MEMBERS_OFFLINE = "Offline. Roster not updated."

data class RosterMember(val userId: String, val role: String, val displayName: String)

@Composable
fun RoomMembersScreen(
    shell: ShellViewModel,
    roomId: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val model: RoomMembersViewModel = viewModel(
        key = "members-$roomId",
        factory = RoomMembersViewModelFactory(shell.container.raceDay, roomId)
    )
    val context = LocalContext.current
    LaunchedEffect(roomId) { model.load(context.isOnline()) }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.room-members")
            .semantics { contentDescription = "Room members" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("Room members")
        model.status?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.members.forEach { member ->
            val label = member.displayName.ifBlank { member.userId }
            Button(
                onClick = { model.select(member.userId) },
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = label }
            ) {
                Text(label)
            }
        }
        if (model.members.isNotEmpty()) {
            OutlinedTextField(
                value = model.draft,
                onValueChange = model::updateDraft,
                label = { Text("Display name") },
                singleLine = true,
                modifier = Modifier
                    .padding(top = 12.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Display name" }
            )
            Button(
                onClick = { model.save(context.isOnline(), shell::noteDisplayName) },
                enabled = !model.busy && model.draft.isNotBlank(),
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Save name" }
            ) {
                Text("Save name")
            }
            Button(
                onClick = { model.removeSelected(context.isOnline()) },
                enabled = !model.busy && model.selectedId != null,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Remove" }
            ) {
                Text("Remove")
            }
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

class RoomMembersViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModel() {
    var members by mutableStateOf<List<RosterMember>>(emptyList())
        private set
    var selectedId by mutableStateOf<String?>(null)
        private set
    var draft by mutableStateOf("")
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    private var generation = 0

    fun load(online: Boolean) {
        val ticket = ++generation
        viewModelScope.launch {
            val result = fetch()
            if (ticket != generation) return@launch
            applyLoad(result, online)
        }
    }

    fun select(userId: String) {
        val member = members.firstOrNull { it.userId == userId } ?: return
        selectedId = member.userId
        draft = member.displayName
    }

    fun updateDraft(value: String) {
        draft = value
    }

    fun save(online: Boolean, onRenamed: (String, String) -> Unit) {
        val userId = selectedId ?: return
        val next = draft.trim()
        if (next.isEmpty() || busy) return
        viewModelScope.launch {
            busy = true
            val ticket = ++generation
            try {
                val result = try {
                    withContext(Dispatchers.IO) { raceDay.updateDisplayName(roomId, userId, next) }
                } catch (_: Throwable) {
                    if (ticket == generation) status = if (online) MEMBERS_ERROR else MEMBERS_OFFLINE
                    return@launch
                }
                if (ticket != generation) return@launch
                when (result) {
                    is RuntimeResult.Failure -> status = if (result.offline || !online) MEMBERS_OFFLINE else MEMBERS_ERROR
                    is RuntimeResult.Success -> {
                        if (result.result.optBoolean("offline")) {
                            status = MEMBERS_OFFLINE
                        } else {
                            onRenamed(userId, next)
                            val updated = parseMembers(result.result)
                            if (updated.isEmpty()) {
                                val loaded = fetch()
                                if (ticket != generation) return@launch
                                applyLoad(loaded, online)
                            } else {
                                adopt(updated)
                            }
                        }
                    }
                }
            } finally {
                busy = false
            }
        }
    }

    fun removeSelected(online: Boolean) {
        val userId = selectedId ?: return
        if (busy) return
        viewModelScope.launch {
            busy = true
            val ticket = ++generation
            try {
                val result = try {
                    withContext(Dispatchers.IO) { raceDay.removeMember(roomId, userId) }
                } catch (_: Throwable) {
                    if (ticket == generation) status = if (online) MEMBERS_ERROR else MEMBERS_OFFLINE
                    return@launch
                }
                if (ticket != generation) return@launch
                when (result) {
                    is RuntimeResult.Failure -> status = if (result.offline || !online) MEMBERS_OFFLINE else MEMBERS_ERROR
                    is RuntimeResult.Success -> {
                        if (result.result.optBoolean("offline")) {
                            status = MEMBERS_OFFLINE
                        } else {
                            val loaded = fetch()
                            if (ticket != generation) return@launch
                            applyLoad(loaded, online)
                        }
                    }
                }
            } finally {
                busy = false
            }
        }
    }

    private suspend fun fetch(): RuntimeResult = try {
        withContext(Dispatchers.IO) { raceDay.loadRoom(roomId) }
    } catch (_: Throwable) {
        RuntimeResult.Failure(MEMBERS_ERROR, offline = false)
    }

    private fun applyLoad(result: RuntimeResult, online: Boolean) {
        when (result) {
            is RuntimeResult.Failure -> status = if (result.offline || !online) MEMBERS_OFFLINE else MEMBERS_ERROR
            is RuntimeResult.Success -> {
                if (result.result.optBoolean("offline")) {
                    status = MEMBERS_OFFLINE
                    return
                }
                adopt(parseMembers(result.result))
            }
        }
    }

    private fun adopt(rows: List<RosterMember>) {
        members = rows
        val current = rows.firstOrNull { it.userId == selectedId } ?: rows.firstOrNull()
        selectedId = current?.userId
        draft = current?.displayName.orEmpty()
        status = if (rows.isEmpty()) MEMBERS_EMPTY else null
    }

    private fun parseMembers(json: JSONObject): List<RosterMember> = parseMembers(json.optJSONArray("memberships"))

    private fun parseMembers(array: JSONArray?): List<RosterMember> {
        if (array == null) return emptyList()
        val rows = mutableListOf<RosterMember>()
        for (index in 0 until array.length()) {
            val row = array.optJSONObject(index) ?: continue
            val userId = row.optString("userId").trim()
            if (userId.isEmpty()) continue
            rows += RosterMember(
                userId = userId,
                role = row.optString("role"),
                displayName = row.optString("displayName").trim()
            )
        }
        return rows
    }
}

class RoomMembersViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return RoomMembersViewModel(raceDay, roomId) as T
    }
}
