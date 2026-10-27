package com.crewcue.android.ui.outbox

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
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
import com.crewcue.android.data.pendingWork
import com.crewcue.android.ui.ShellViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun OutboxScreen(shell: ShellViewModel, modifier: Modifier = Modifier) {
    val model: OutboxViewModel = viewModel(
        key = "outbox-${shell.session?.userId}",
        factory = OutboxViewModelFactory(shell.container.raceDay)
    )
    LaunchedEffect(model) { model.load() }
    Column(
        modifier
            .testTag("crewcue.outbox")
            .semantics { contentDescription = "Outbox" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("Outbox")
        Text(
            model.message,
            modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.message }
        )
        model.lines.forEach { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
    }
}

class OutboxViewModel(private val raceDay: RaceDayBridge) : ViewModel() {
    var message by mutableStateOf("Outbox is empty.")
        private set
    var lines by mutableStateOf<List<String>>(emptyList())
        private set

    fun load() {
        viewModelScope.launch {
            val status = withContext(Dispatchers.IO) { raceDay.listOutbox() }.pendingWork()
            message = status.message
            lines = status.lines
        }
    }
}

class OutboxViewModelFactory(private val raceDay: RaceDayBridge) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return OutboxViewModel(raceDay) as T
    }
}
