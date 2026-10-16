package com.crewcue.android.ui.profile

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.ReportProblem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.R
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.RaceChoice
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.map.MapViewModel
import com.crewcue.android.ui.map.RaceReadout
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.theme.ChipStyle
import com.crewcue.android.ui.theme.CrewListRow
import com.crewcue.android.ui.theme.CrewProgressBar
import com.crewcue.android.ui.theme.IconDisc
import com.crewcue.android.ui.theme.CrewTextField
import com.crewcue.android.ui.theme.LocalCrewExtras
import com.crewcue.android.ui.theme.MetricLargeStyle
import com.crewcue.android.ui.theme.MetricStyle
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.SecondaryButton
import com.crewcue.android.ui.theme.SectionHeader
import com.crewcue.android.ui.theme.StatusChip
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

const val PROFILE_EMPTY = "Display name is empty."
const val PROFILE_ERROR = "Couldn't load profile."
const val PROFILE_OFFLINE = "Offline. Profile not updated."

@Composable
fun ProfileScreen(shell: ShellViewModel, modifier: Modifier = Modifier, race: MapViewModel? = null) {
    val session = shell.session
    val model: ProfileViewModel = viewModel(
        key = "profile-${session?.userId}",
        factory = ProfileViewModelFactory(shell.container.raceDay, session?.displayName.orEmpty())
    )
    val context = LocalContext.current
    LaunchedEffect(session?.userId, session?.roomId, session?.displayName) {
        model.load(
            userId = session?.userId.orEmpty(),
            roomId = session?.roomId,
            sessionName = session?.displayName.orEmpty(),
            online = context.isOnline()
        )
    }
    val roomId = session?.roomId
    val readout = race?.readout ?: RaceReadout()
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.profile")
            .semantics { contentDescription = "Profile" }
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(top = 12.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        ProfileHero(
            name = model.name.ifBlank { "Profile" },
            role = shell.races.firstOrNull { it.id == roomId }?.roleLabel,
            live = readout.lastPingLabel != null
        )
        val status = model.status
        if (status != null) {
            Text(
                status,
                modifier = Modifier.semantics { contentDescription = status },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (!roomId.isNullOrBlank()) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard("Current pace", readout.averagePaceLabel, "Min / mile", accent = true, modifier = Modifier.weight(1f))
                StatCard("Time elapsed", readout.elapsedLabel, "HH:MM:SS", accent = false, modifier = Modifier.weight(1f))
            }
            ProductCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        readout.progressLabel,
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(readout.percentLabel, style = MetricStyle, color = MaterialTheme.colorScheme.primary)
                }
                CrewProgressBar(readout.progressFraction, Modifier.padding(top = 12.dp))
            }
            ProductCard {
                SectionHeader("Race & crew")
                CrewListRow(Icons.Outlined.Groups, "Room members", onClick = shell::openRoomMembers, detail = "Your crew for this race")
                CrewListRow(Icons.Outlined.ReportProblem, "Incidents", onClick = shell::openIncidents, detail = "Log and review race incidents")
            }
        }
        ProductCard {
            SectionHeader("Your races")
            if (shell.races.isNotEmpty()) {
                Column(Modifier.padding(top = 8.dp).testTag("crewcue.race-switcher")) {
                    shell.races.forEach { item ->
                        RaceRow(item, active = item.id == roomId) { shell.selectRace(item.id) }
                    }
                }
            }
            if (shell.racesMessage.isNotBlank()) {
                Text(
                    shell.racesMessage,
                    modifier = Modifier.padding(top = 8.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CrewTextField(model.raceName, model::updateRaceName, "Race name")
                PrimaryButton(
                    "Create new race",
                    onClick = {
                        val userId = session?.userId.orEmpty()
                        model.createRace(userId, session?.displayName) { created -> shell.adoptRoom(created) }
                    },
                    enabled = !model.creatingRace
                )
                SecondaryButton("Join race room", onClick = shell::openJoinCrew)
            }
        }
    }
}

/** One loaded race. Tapping it makes it the race Map, Pace, Chat, and Profile follow. */
@Composable
private fun RaceRow(race: RaceChoice, active: Boolean, onSelect: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val label = if (active) "${race.name}, active race" else race.name
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .selectable(selected = active, enabled = !active, role = Role.RadioButton, onClick = onSelect)
            .padding(vertical = 8.dp)
            .testTag("crewcue.race-switcher.${race.id}")
            .semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconDisc(if (active) Icons.Filled.Flag else Icons.Outlined.Flag, if (active) colors.primary else colors.outline)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(
                race.name,
                style = MaterialTheme.typography.titleMedium,
                color = if (active) colors.primary else colors.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                race.roleLabel,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant
            )
        }
        if (active) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.primary)
        }
    }
}

/** Runner hero: night-trail gradient, illustration, name, role, and live chip. */
@Composable
private fun ProfileHero(name: String, role: String?, live: Boolean) {
    val extras = LocalCrewExtras.current
    Box(
        Modifier
            .fillMaxWidth()
            .height(240.dp)
            .clip(MaterialTheme.shapes.large)
            .background(Brush.linearGradient(extras.heroGradient))
            .semantics(mergeDescendants = true) {}
    ) {
        Image(
            painter = painterResource(R.drawable.onboarding_runner),
            contentDescription = null,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .fillMaxHeight()
                .padding(top = 8.dp)
                .offset(x = 24.dp),
            contentScale = ContentScale.Fit
        )
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f)))))
        Row(
            Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(24.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.displaySmall, color = Color.White, maxLines = 2)
                if (!role.isNullOrBlank()) {
                    Text(
                        role,
                        style = MaterialTheme.typography.labelMedium,
                        color = extras.heroAccent
                    )
                }
            }
            if (live) StatusChip("Live tracking", ChipStyle.Secondary, dot = true)
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, caption: String, accent: Boolean, modifier: Modifier = Modifier) {
    ProductCard(modifier, padding = PaddingValues(20.dp)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value,
            modifier = Modifier.padding(top = 24.dp),
            style = MetricLargeStyle,
            color = if (accent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(caption.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    var raceName by mutableStateOf("")
        private set
    var creatingRace by mutableStateOf(false)
        private set

    private var generation = 0

    fun updateRaceName(value: String) {
        raceName = value
    }

    fun createRace(userId: String, displayName: String?, onCreated: (String) -> Unit) {
        val trimmed = raceName.trim()
        if (trimmed.isEmpty()) {
            status = "Enter a race name."
            return
        }
        if (userId.isBlank() || creatingRace) {
            if (userId.isBlank()) status = "Couldn't create the race."
            return
        }
        creatingRace = true
        viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) {
                    raceDay.createRoom(trimmed, userId, userId, displayName)
                }
            } catch (_: Throwable) {
                creatingRace = false
                status = "Couldn't create the race."
                return@launch
            }
            creatingRace = false
            when (result) {
                is RuntimeResult.Failure -> {
                    status = if (result.offline) PROFILE_OFFLINE else "Couldn't create the race."
                }
                is RuntimeResult.Success -> {
                    val roomId = result.result.optString("id")
                    if (roomId.isBlank()) {
                        status = "Couldn't create the race."
                    } else {
                        raceName = ""
                        status = "Race created."
                        onCreated(roomId)
                    }
                }
            }
        }
    }

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
