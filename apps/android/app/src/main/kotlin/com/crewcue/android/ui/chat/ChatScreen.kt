package com.crewcue.android.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.ui.ShellViewModel

@Composable
fun ChatScreen(
    shell: ShellViewModel,
    roomId: String,
    onOpenAlerts: () -> Unit,
    onOpenPush: () -> Unit,
    modifier: Modifier = Modifier
) {
    val model: ChatViewModel = viewModel(
        key = "chat-$roomId",
        factory = ChatViewModelFactory(shell.container.raceDay, roomId)
    )
    val context = LocalContext.current
    LaunchedEffect(roomId) { model.load(context.applicationContext) }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.chat")
            .semantics { contentDescription = "Chat" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("Chat", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            model.channelId,
            modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.channelId }
        )
        model.messages.forEach { line ->
            Surface(
                modifier = Modifier.padding(top = 8.dp),
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh
            ) {
                Text(
                    line,
                    modifier = Modifier.padding(12.dp).semantics { contentDescription = line }
                )
            }
        }
        model.status?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
        model.mentionNames.forEach { name ->
            Text(name, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = name })
        }
        OutlinedTextField(
            value = model.draft,
            onValueChange = model::updateDraft,
            label = { Text("Message") },
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Message" }
        )
        Button(
            onClick = { model.send(context.applicationContext) },
            enabled = !model.sending,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Send" }
        ) {
            Text("Send")
        }
        Button(
            onClick = onOpenAlerts,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Chat alerts" }
        ) {
            Text("Alerts")
        }
        Button(
            onClick = onOpenPush,
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Push" }
        ) {
            Text("Push")
        }
    }
}
