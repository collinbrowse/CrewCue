package com.crewcue.android.ui.profile

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.material.icons.outlined.ConfirmationNumber
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.runtime.remember
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import com.crewcue.android.ui.theme.SettingRow
import androidx.compose.foundation.combinedClickable
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.ui.semantics.selected
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import com.crewcue.android.ui.RaceChoice
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.brand.CairnLoader
import com.crewcue.android.ui.brand.CourseProfileArt
import com.crewcue.android.ui.map.MapViewModel
import com.crewcue.android.ui.map.RaceReadout
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.theme.ChipStyle
import com.crewcue.android.ui.theme.CrewListRow
import com.crewcue.android.ui.theme.CrewProgressBar
import com.crewcue.android.ui.theme.CompactTextField
import com.crewcue.android.ui.theme.PillButton
import com.crewcue.android.ui.theme.RowTitleStyle
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.crewcue.android.ui.theme.IconDisc
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
            live = readout.pingState == "live"
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
                val activeRace = shell.races.firstOrNull { it.id == roomId }
                val role = activeRace?.role ?: session?.role.orEmpty()
                // The runner, crew chiefs and team managers rename the race (client-core decides).
                val renameText = model.renameText(role)
                if (renameText.mayRename && roomId != null) {
                    RenameRaceRow(model, renameText, roomId, activeRace?.name.orEmpty(), onRenamed = shell::noteRaceRenamed)
                }
                if (role == "athlete") {
                    CrewListRow(
                        Icons.Outlined.ConfirmationNumber,
                        shell.onboardingText.racePassTitle.ifBlank { "Race Pass" },
                        onClick = shell::openRacePass,
                        detail = "Unlock this race for your crew",
                        modifier = Modifier.testTag("crewcue.profile.race-pass")
                    )
                }
                // Only the owner sees it: it removes the race for the whole crew.
                if (activeRace?.owner == true) {
                    val text = model.deleteText
                    CrewListRow(
                        Icons.Outlined.Delete,
                        text.rowTitle,
                        onClick = { model.confirmDelete(activeRace) },
                        detail = text.rowDetail,
                        tint = MaterialTheme.colorScheme.error,
                        titleColor = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("crewcue.race-delete")
                    )
                }
            }
        }
        ProductCard {
            SectionHeader("Your races")
            if (shell.races.isEmpty() && shell.racesLoading) {
                Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                    CairnLoader(
                        modifier = Modifier.size(56.dp).testTag("crewcue.races-loading"),
                        onLight = !LocalCrewExtras.current.dark
                    )
                }
            }
            if (shell.races.isNotEmpty()) {
                Column(Modifier.padding(top = 8.dp).testTag("crewcue.race-switcher")) {
                    shell.races.forEach { item ->
                        RaceRow(
                            item,
                            active = item.id == roomId,
                            onSelect = { shell.selectRace(item.id) },
                            // Long-press an owned race for Delete race; rows carry no trash button.
                            deleteLabel = model.deleteText.rowTitle.takeIf { item.owner },
                            menuOpen = model.deleteMenuRaceId == item.id,
                            onMenu = { open -> model.showDeleteMenu(if (open) item.id else null) },
                            onDelete = { model.confirmDelete(item) }
                        )
                    }
                }
            }
            val deleteMessage = model.deleteMessage
            if (!deleteMessage.isNullOrBlank()) {
                Text(
                    deleteMessage,
                    modifier = Modifier.padding(top = 8.dp).testTag("crewcue.race-delete.message"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
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
                val create = {
                    val userId = session?.userId.orEmpty()
                    model.createRace(userId, session?.displayName) { created -> shell.adoptCreatedRoom(created) }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CompactTextField(
                        model.raceName,
                        model::updateRaceName,
                        placeholder = "New race name",
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { create() }),
                        spoken = "Race name"
                    )
                    PillButton("Create", onClick = create, prominent = true, busy = model.creatingRace, spoken = "Create new race")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Have an invite code?",
                        modifier = Modifier.weight(1f).padding(end = 8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                    PillButton("Join race room", onClick = shell::openJoinCrew)
                }
            }
        }
    }
    RaceDeleteConfirm(model, onDeleted = shell::noteRaceDeleted)
}

/**
 * Race & crew → Rename race: one row that opens a dialog with the name field (same as iOS's
 * alert). Save sends the trimmed name; the list and top bar follow once the server saved it.
 */
@Composable
private fun RenameRaceRow(
    model: ProfileViewModel,
    text: RaceRenameText,
    roomId: String,
    currentName: String,
    onRenamed: (String, String) -> Unit
) {
    SettingRow(
        Icons.Outlined.Edit,
        text.rowTitle,
        modifier = Modifier.testTag("crewcue.race-rename"),
        hint = if (model.renameRoomId == null) model.renameMessage ?: text.rowDetail else text.rowDetail,
        onClick = { model.beginRename(roomId, currentName) }
    )
    if (model.renameRoomId == roomId) {
        RenameRaceDialog(model, text, roomId, onRenamed)
    }
}

@Composable
private fun RenameRaceDialog(
    model: ProfileViewModel,
    text: RaceRenameText,
    roomId: String,
    onRenamed: (String, String) -> Unit
) {
    val context = LocalContext.current
    val field = remember { FocusRequester() }
    val save = { model.saveRename(roomId, text, context.isOnline(), onRenamed) }
    AlertDialog(
        onDismissRequest = model::cancelRename,
        modifier = Modifier.testTag("crewcue.race-rename.dialog"),
        title = { Text(text.rowTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CompactTextField(
                    value = model.renameDraft,
                    onValueChange = { model.updateRenameDraft(it, text.maxLength) },
                    placeholder = "Race name",
                    modifier = Modifier.fillMaxWidth().focusRequester(field).testTag("crewcue.race-rename.field"),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { if (model.renameDraft.isNotBlank()) save() })
                )
                Text(
                    model.renameMessage ?: text.hint,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            LaunchedEffect(Unit) { runCatching { field.requestFocus() } }
        },
        confirmButton = {
            PillButton(
                "Save",
                onClick = save,
                prominent = true,
                enabled = model.renameDraft.isNotBlank(),
                busy = model.renaming,
                spoken = "Save race name",
                modifier = Modifier.testTag("crewcue.race-rename.save")
            )
        },
        dismissButton = {
            PillButton("Cancel", onClick = model::cancelRename, modifier = Modifier.testTag("crewcue.race-rename.cancel"))
        }
    )
}

/** The destructive confirm: names the race, warns about a paid race's pass, then Delete race or Cancel. */
@Composable
private fun RaceDeleteConfirm(model: ProfileViewModel, onDeleted: (String) -> Unit) {
    val race = model.pendingDelete ?: return
    val text = model.pendingDeleteText
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = model::cancelDelete,
        modifier = Modifier.testTag("crewcue.race-delete.confirm"),
        title = { Text(text.confirmTitle) },
        text = { Text(text.confirmBody) },
        confirmButton = {
            PillButton(
                text.confirmButton,
                onClick = { model.delete(race, context.isOnline(), onDeleted) },
                destructive = true,
                modifier = Modifier.testTag("crewcue.race-delete.confirm-button")
            )
        },
        dismissButton = {
            PillButton(text.cancelButton, onClick = model::cancelDelete, modifier = Modifier.testTag("crewcue.race-delete.cancel"))
        }
    )
}

/**
 * One loaded race. Tapping it makes it the race Map, Pace, Chat, and Profile follow. With a
 * [deleteLabel] (an owned race) a long-press opens a menu with Delete race.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun RaceRow(
    race: RaceChoice,
    active: Boolean,
    onSelect: () -> Unit,
    deleteLabel: String? = null,
    menuOpen: Boolean = false,
    onMenu: (Boolean) -> Unit = {},
    onDelete: () -> Unit = {}
) {
    val colors = MaterialTheme.colorScheme
    val label = if (active) "${race.name}, active race" else race.name
    Box {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .then(
                if (deleteLabel != null) {
                    Modifier.combinedClickable(
                        role = Role.RadioButton,
                        onClick = { if (!active) onSelect() },
                        onLongClick = { onMenu(true) },
                        onLongClickLabel = deleteLabel
                    )
                } else {
                    Modifier.selectable(selected = active, enabled = !active, role = Role.RadioButton, onClick = onSelect)
                }
            )
            .padding(vertical = 8.dp)
            .testTag("crewcue.race-switcher.${race.id}")
            .semantics(mergeDescendants = true) {
                contentDescription = label
                selected = active
            },
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Settings density: a plain icon, a title that wraps and a gray hint.
        Icon(
            if (active) Icons.Filled.Flag else Icons.Outlined.Flag,
            contentDescription = null,
            tint = colors.primary,
            modifier = Modifier.size(28.dp).padding(2.dp)
        )
        Column(Modifier.weight(1f).padding(start = 12.dp, end = 8.dp)) {
            Text(race.name, style = RowTitleStyle, color = if (active) colors.primary else colors.onSurface)
            Text(race.roleLabel, style = MaterialTheme.typography.bodySmall, color = colors.outline)
        }
        if (active) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.primary)
        }
    }
    if (deleteLabel != null) {
        DropdownMenu(expanded = menuOpen, onDismissRequest = { onMenu(false) }) {
            DropdownMenuItem(
                text = { Text(deleteLabel, color = colors.error) },
                leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = colors.error) },
                onClick = {
                    onMenu(false)
                    onDelete()
                },
                modifier = Modifier.testTag("crewcue.race-delete.menu.${race.id}")
            )
        }
    }
    }
}

/** Runner hero: slate ground, course-profile art, name, role, and live chip. */
@Composable
private fun ProfileHero(name: String, role: String?, live: Boolean) {
    val extras = LocalCrewExtras.current
    Box(
        Modifier
            .fillMaxWidth()
            .height(180.dp)
            .clip(MaterialTheme.shapes.large)
            .background(Brush.linearGradient(extras.heroGradient))
            .semantics(mergeDescendants = true) {}
    ) {
        CourseProfileArt(Modifier.fillMaxSize().padding(top = 28.dp, bottom = 64.dp), ground = false)
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
    ProductCard(modifier, padding = PaddingValues(16.dp)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value,
            modifier = Modifier.padding(top = 6.dp),
            style = MetricStyle,
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

    /** Delete race row and menu copy, read once from client-core. */
    val deleteText: RaceDeleteText by lazy { readDeleteText("", false) }
    /** The race the confirm is on show for, and its copy (the title names it; a paid race warns). */
    var pendingDelete by mutableStateOf<RaceChoice?>(null)
        private set
    var pendingDeleteText by mutableStateOf(RaceDeleteText())
        private set
    /** The owned race whose long-press menu is open. */
    var deleteMenuRaceId by mutableStateOf<String?>(null)
        private set
    var deletingRaceId by mutableStateOf<String?>(null)
        private set
    var deleteMessage by mutableStateOf<String?>(null)
        private set

    private fun readDeleteText(raceName: String, paid: Boolean): RaceDeleteText =
        RaceDeleteText.from((runCatching { raceDay.raceDeletionCopy(raceName, paid) }.getOrNull() as? RuntimeResult.Success)?.result)

    fun showDeleteMenu(roomId: String?) {
        deleteMenuRaceId = roomId
    }

    /** Opens the confirm for [race]. Only an owned race is offered it; crew never are. */
    fun confirmDelete(race: RaceChoice) {
        deleteMenuRaceId = null
        if (!race.owner || deletingRaceId != null) return
        deleteMessage = null
        pendingDeleteText = readDeleteText(race.name, race.paid)
        pendingDelete = race
    }

    fun cancelDelete() {
        pendingDelete = null
    }

    /**
     * Deletes [race] for the whole crew. [onDeleted] runs only once the server says it is gone, so
     * a failure leaves the race listed (and active) with the shared failure line.
     */
    fun delete(race: RaceChoice, online: Boolean, onDeleted: (String) -> Unit) {
        if (deletingRaceId != null) return
        pendingDelete = null
        deletingRaceId = race.id
        val text = deleteText
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { raceDay.deleteRace(race.id) }.getOrElse { RuntimeResult.Failure("Request failed", offline = !online) }
            }
            deletingRaceId = null
            when (val outcome = raceDeleteOutcome(result, text, online)) {
                RaceDeleteOutcome.Deleted -> {
                    deleteMessage = text.deletedMessage
                    onDeleted(race.id)
                }
                is RaceDeleteOutcome.Failed -> deleteMessage = outcome.message
            }
        }
    }

    private var renameTexts = mapOf<String, RaceRenameText>()

    /** Rename race copy and whether [role] may rename, read once per role from client-core. */
    fun renameText(role: String): RaceRenameText = renameTexts[role] ?: RaceRenameText.from(
        (runCatching { raceDay.raceRenameCopy(role) }.getOrNull() as? RuntimeResult.Success)?.result
    ).also { renameTexts = renameTexts + (role to it) }

    /** The race whose name is being edited (null: the row shows the name with Edit). Kept across a fold. */
    var renameRoomId by mutableStateOf<String?>(null)
        private set
    var renameDraft by mutableStateOf("")
        private set
    var renaming by mutableStateOf(false)
        private set
    /** The last rename's line (saved, or why not), in place of the row's hint. */
    var renameMessage by mutableStateOf<String?>(null)
        private set

    fun beginRename(roomId: String, currentName: String) {
        renameRoomId = roomId
        renameDraft = currentName
        renameMessage = null
    }

    fun cancelRename() {
        if (renaming) return
        renameRoomId = null
        renameMessage = null
    }

    fun updateRenameDraft(value: String, maxLength: Int) {
        renameDraft = value.take(maxLength)
    }

    /**
     * Saves the draft for [roomId]. [onRenamed] runs only once the server saved it, so the race
     * list and top bar show the new name; a failure keeps the field open with the shared line.
     */
    fun saveRename(roomId: String, text: RaceRenameText, online: Boolean, onRenamed: (String, String) -> Unit) {
        if (renaming) return
        val draft = renameDraft
        if (draft.isBlank()) {
            renameMessage = text.invalid
            return
        }
        renaming = true
        renameMessage = null
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { raceDay.renameRace(roomId, draft) }.getOrElse { RuntimeResult.Failure("Request failed", offline = !online) }
            }
            renaming = false
            when (val outcome = raceRenameOutcome(result, text, online)) {
                is RaceRenameOutcome.Renamed -> {
                    renameRoomId = null
                    renameMessage = outcome.message
                    onRenamed(outcome.roomId, outcome.name)
                }
                is RaceRenameOutcome.Failed -> renameMessage = outcome.message
            }
        }
    }

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
            return row.optText("displayName").trim()
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
