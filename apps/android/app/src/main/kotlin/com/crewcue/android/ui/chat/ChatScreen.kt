package com.crewcue.android.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductTitle
import com.crewcue.android.ui.theme.SecondaryButton
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import android.graphics.BitmapFactory
import com.crewcue.android.ui.ShellViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL

@Composable
private fun ChatImage(url: String, modifier: Modifier = Modifier) {
    var bitmap by remember(url) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(url) {
        bitmap = withContext(Dispatchers.IO) {
            runCatching { BitmapFactory.decodeStream(URL(url).openStream()) }.getOrNull()
        }
    }
    val loaded = bitmap
    if (loaded != null) {
        Image(
            loaded.asImageBitmap(),
            contentDescription = "Image",
            modifier = modifier,
            contentScale = ContentScale.Fit
        )
    }
}

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
    LaunchedEffect(model.unread) { shell.noteChatUnread(model.unread) }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.chat")
            .semantics { contentDescription = "Chat" }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        ProductTitle("Chat", "The crew channel for this race.")
        if (model.channelId.isNotBlank()) {
            Text(
                model.channelId,
                modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = model.channelId },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        model.messages.forEach { line ->
            Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                if (line.mine) Spacer(Modifier.weight(1f))
                Surface(
                    modifier = Modifier.widthIn(max = 280.dp),
                    shape = RoundedCornerShape(12.dp),
                    color = if (line.mine) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceContainerHigh
                    }
                ) {
                    Column(Modifier.padding(12.dp).semantics { contentDescription = line.text.ifBlank { line.author } }) {
                        if (line.author.isNotBlank()) {
                            Text(line.author, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium)
                        }
                        if (line.text.isNotBlank()) {
                            Text(line.text, modifier = Modifier.padding(top = 4.dp))
                        }
                        line.imageUrl?.let { url ->
                            ChatImage(url, Modifier.padding(top = 6.dp).heightIn(max = 180.dp))
                        }
                        if (line.reactions.isNotBlank()) {
                            Text(line.reactions, modifier = Modifier.padding(top = 4.dp))
                        }
                        if (line.time.isNotBlank()) {
                            Text(line.time, modifier = Modifier.padding(top = 4.dp), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                if (!line.mine) Spacer(Modifier.weight(1f))
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
        PrimaryButton(
            "Send",
            onClick = { model.send(context.applicationContext) },
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.sending
        )
        SecondaryButton(
            "Alerts",
            onClick = onOpenAlerts,
            modifier = Modifier.padding(top = 8.dp),
            spoken = "Chat alerts"
        )
        SecondaryButton(
            "This device",
            onClick = onOpenPush,
            modifier = Modifier.padding(top = 8.dp),
            spoken = "Push"
        )
    }
}
