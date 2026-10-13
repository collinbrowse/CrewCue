package com.crewcue.android.ui.incidents

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
import com.crewcue.android.ui.map.isOnline
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

const val INCIDENTS_EMPTY = "No incidents."
const val INCIDENTS_ERROR = "Couldn't load incidents."
const val INCIDENTS_OFFLINE = "Offline. Incidents not updated."

private val categories = listOf(
    "fuel" to "Fuel",
    "hydration" to "Hydration",
    "aid_duration" to "Aid duration",
    "equipment" to "Equipment",
    "protocol_deviation" to "Protocol deviation",
    "other" to "Other"
)

private val severities = listOf(
    "low" to "Low",
    "medium" to "Medium",
    "high" to "High"
)

@Composable
fun IncidentsScreen(
    raceDay: RaceDayBridge,
    roomId: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val model: IncidentsViewModel = viewModel(
        key = "incidents-$roomId",
        factory = IncidentsViewModelFactory(raceDay, roomId)
    )
    val context = LocalContext.current
    LaunchedEffect(roomId) { model.load(context.isOnline()) }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.readouts-incidents")
            .semantics { contentDescription = "Incidents" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("Incidents")
        model.summaries.forEach { summary ->
            Text(summary, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = summary })
        }
        model.status?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        ChoiceRow("Category", categories, model.category, model.busy, model::selectCategory)
        ChoiceRow("Severity", severities, model.severity, model.busy, model::selectSeverity)
        OutlinedTextField(
            value = model.summary,
            onValueChange = model::updateSummary,
            label = { Text("Summary") },
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Summary" }
        )
        OutlinedTextField(
            value = model.checkpointId,
            onValueChange = model::updateCheckpoint,
            label = { Text("Checkpoint") },
            placeholder = { Text("Optional") },
            singleLine = true,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Checkpoint" }
        )
        Button(
            onClick = { model.submit(context.isOnline()) },
            enabled = !model.busy && model.summary.isNotBlank(),
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Submit" }
        ) {
            Text("Submit")
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

@Composable
private fun ChoiceRow(
    title: String,
    options: List<Pair<String, String>>,
    selected: String,
    busy: Boolean,
    onSelect: (String) -> Unit
) {
    Text(title, modifier = Modifier.padding(top = 12.dp))
    options.forEach { (value, label) ->
        val spoken = if (selected == value) "$label selected" else label
        Button(
            onClick = { onSelect(value) },
            enabled = !busy,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = spoken }
        ) {
            Text(spoken)
        }
    }
}

class IncidentsViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModel() {
    var summaries by mutableStateOf<List<String>>(emptyList())
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var category by mutableStateOf("other")
        private set
    var severity by mutableStateOf("low")
        private set
    var summary by mutableStateOf("")
        private set
    var checkpointId by mutableStateOf("")
        private set
    var busy by mutableStateOf(false)
        private set

    private var generation = 0

    fun load(online: Boolean) {
        val ticket = ++generation
        viewModelScope.launch {
            val result = fetch()
            if (ticket != generation) return@launch
            apply(result, online)
        }
    }

    fun selectCategory(value: String) {
        category = value
    }

    fun selectSeverity(value: String) {
        severity = value
    }

    fun updateSummary(value: String) {
        summary = value
    }

    fun updateCheckpoint(value: String) {
        checkpointId = value
    }

    fun submit(online: Boolean) {
        val text = summary.trim()
        if (text.isEmpty() || busy) return
        viewModelScope.launch {
            busy = true
            val ticket = ++generation
            try {
                val checkpoint = checkpointId.trim().ifBlank { null }
                val result = try {
                    withContext(Dispatchers.IO) {
                        raceDay.createIncident(roomId, category, severity, text, checkpoint)
                    }
                } catch (_: Throwable) {
                    if (ticket == generation) status = if (online) INCIDENTS_ERROR else INCIDENTS_OFFLINE
                    return@launch
                }
                if (ticket != generation) return@launch
                when (result) {
                    is RuntimeResult.Failure -> status = if (result.offline || !online) INCIDENTS_OFFLINE else INCIDENTS_ERROR
                    is RuntimeResult.Success -> {
                        if (result.result.optBoolean("offline")) {
                            status = INCIDENTS_OFFLINE
                        } else {
                            summary = ""
                            checkpointId = ""
                            val created = result.result.optJSONObject("incident")?.optString("summary")?.trim().orEmpty()
                            if (created.isNotEmpty()) summaries = summaries + created
                            val loaded = fetch()
                            if (ticket != generation) return@launch
                            apply(loaded, online)
                        }
                    }
                }
            } finally {
                busy = false
            }
        }
    }

    private suspend fun fetch(): RuntimeResult = try {
        withContext(Dispatchers.IO) { raceDay.incidents(roomId) }
    } catch (_: Throwable) {
        RuntimeResult.Failure(INCIDENTS_ERROR, offline = false)
    }

    private fun apply(result: RuntimeResult, online: Boolean) {
        when (result) {
            is RuntimeResult.Failure -> status = if (result.offline || !online) INCIDENTS_OFFLINE else INCIDENTS_ERROR
            is RuntimeResult.Success -> {
                if (result.result.optBoolean("offline")) {
                    status = INCIDENTS_OFFLINE
                    return
                }
                summaries = parseSummaries(result.result)
                status = if (summaries.isEmpty()) INCIDENTS_EMPTY else null
            }
        }
    }

    private fun parseSummaries(json: JSONObject): List<String> = parseSummaries(json.optJSONArray("incidents"))

    private fun parseSummaries(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        val lines = mutableListOf<String>()
        for (index in 0 until array.length()) {
            val row = array.optJSONObject(index) ?: continue
            val summary = row.optString("summary").trim()
            if (summary.isNotEmpty()) lines += summary
        }
        return lines
    }
}

class IncidentsViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return IncidentsViewModel(raceDay, roomId) as T
    }
}
