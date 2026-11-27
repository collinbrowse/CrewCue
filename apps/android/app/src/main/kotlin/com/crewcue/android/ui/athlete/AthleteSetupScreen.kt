package com.crewcue.android.ui.athlete

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun AthleteSetupScreen(shell: ShellViewModel) {
    val context = LocalContext.current
    val session = shell.session
    var name by remember {
        mutableStateOf(shell.container.athleteDraft.read() ?: session?.displayName.orEmpty())
    }
    var message by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val status = if (name.isBlank()) "Name is required." else message
    Column(
        Modifier
            .fillMaxSize()
            .testTag("crewcue.athlete-setup")
            .semantics { contentDescription = "Athlete setup" }
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        ProductTitle("Your name", "Crew sees this on the schedule and in chat.")
        ProductCard(Modifier.padding(top = 16.dp)) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Display name") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = "Display name" }
            )
            if (status.isNotBlank()) {
                Text(status, modifier = Modifier.padding(top = 12.dp).semantics { contentDescription = status })
            }
            PrimaryButton(
                "Save",
                onClick = {
                    val trimmed = name.trim()
                    if (trimmed.isEmpty() || working) {
                        message = "Name is required."
                    } else {
                        working = true
                        scope.launch {
                            message = saveAthleteName(context, shell, trimmed)
                            working = false
                        }
                    }
                },
                modifier = Modifier.padding(top = 12.dp),
                enabled = !working
            )
        }
    }
}

private suspend fun saveAthleteName(context: Context, shell: ShellViewModel, name: String): String {
    val session = shell.session
    val roomId = session?.roomId
    val userId = session?.userId
    if (roomId.isNullOrBlank() || userId.isNullOrBlank() || !context.isOnline()) {
        shell.container.athleteDraft.write(name)
        return "Offline. Setup will sync when the network returns."
    }
    val result = try {
        withContext(Dispatchers.IO) { shell.container.raceDay.updateDisplayName(roomId, userId, name) }
    } catch (_: Throwable) {
        shell.container.athleteDraft.write(name)
        return if (context.isOnline()) {
            "Couldn't save athlete setup."
        } else {
            "Offline. Setup will sync when the network returns."
        }
    }
    return when (result) {
        is RuntimeResult.Failure -> {
            if (result.offline) {
                shell.container.athleteDraft.write(name)
                "Offline. Setup will sync when the network returns."
            } else {
                "Couldn't save athlete setup."
            }
        }
        is RuntimeResult.Success -> {
            if (result.result.optBoolean("offline")) {
                shell.container.athleteDraft.write(name)
                "Offline. Setup will sync when the network returns."
            } else {
                shell.container.athleteDraft.write(name)
                shell.noteDisplayName(userId, name)
                "Athlete profile saved on this device."
            }
        }
    }
}
