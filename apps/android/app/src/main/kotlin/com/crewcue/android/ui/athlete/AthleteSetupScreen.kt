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
import org.json.JSONObject
import java.io.File

@Composable
fun AthleteSetupScreen(shell: ShellViewModel) {
    val context = LocalContext.current
    val session = shell.session
    var name by remember {
        mutableStateOf(readAthleteDraft(context) ?: session?.displayName.orEmpty())
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
        writeAthleteDraft(context, name)
        return "Offline. Setup will sync when the network returns."
    }
    val result = try {
        withContext(Dispatchers.IO) { shell.container.raceDay.updateDisplayName(roomId, userId, name) }
    } catch (_: Throwable) {
        writeAthleteDraft(context, name)
        return if (context.isOnline()) {
            "Couldn't save athlete setup."
        } else {
            "Offline. Setup will sync when the network returns."
        }
    }
    return when (result) {
        is RuntimeResult.Failure -> {
            if (result.offline) {
                writeAthleteDraft(context, name)
                "Offline. Setup will sync when the network returns."
            } else {
                "Couldn't save athlete setup."
            }
        }
        is RuntimeResult.Success -> {
            if (result.result.optBoolean("offline")) {
                writeAthleteDraft(context, name)
                "Offline. Setup will sync when the network returns."
            } else {
                writeAthleteDraft(context, name)
                shell.noteDisplayName(userId, name)
                "Athlete profile saved on this device."
            }
        }
    }
}

private fun draftFile(context: Context): File {
    val directory = File(context.filesDir, "crewcue")
    directory.mkdirs()
    return File(directory, "athlete-draft.json")
}

private fun readAthleteDraft(context: Context): String? {
    val file = draftFile(context)
    if (!file.exists()) return null
    val name = runCatching { JSONObject(file.readText()).optString("displayName") }.getOrNull()?.trim().orEmpty()
    return name.ifBlank { null }
}

private fun writeAthleteDraft(context: Context, name: String) {
    runCatching {
        draftFile(context).writeText(JSONObject().put("displayName", name).toString())
    }
}
