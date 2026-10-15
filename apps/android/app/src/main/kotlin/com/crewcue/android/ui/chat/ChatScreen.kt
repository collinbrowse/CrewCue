package com.crewcue.android.ui.chat

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.map.MapViewModel
import com.crewcue.android.ui.theme.ChipStyle
import com.crewcue.android.ui.theme.CrewClock
import com.crewcue.android.ui.theme.Kicker
import com.crewcue.android.ui.theme.MetricLargeStyle
import com.crewcue.android.ui.theme.StatusChip
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
    modifier: Modifier = Modifier,
    race: MapViewModel? = null
) {
    val model: ChatViewModel = viewModel(
        key = "chat-$roomId",
        factory = ChatViewModelFactory(shell.container.raceDay, roomId)
    )
    val context = LocalContext.current
    LaunchedEffect(roomId) { model.load(context.applicationContext) }
    LaunchedEffect(model.unread) { shell.noteChatUnread(model.unread) }
    val listState = rememberLazyListState()
    LaunchedEffect(model.messages.size) {
        if (model.messages.isNotEmpty()) listState.animateScrollToItem(model.messages.lastIndex)
    }
    Column(
        modifier
            .fillMaxSize()
            .testTag("crewcue.chat")
            .semantics { contentDescription = "Chat" }
            .imePadding()
    ) {
        ChatStatusHeader(race, shell.races.firstOrNull { it.id == roomId }?.name.orEmpty())
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            items(model.messages) { line -> ChatBubble(line) }
        }
        model.status?.let { line ->
            Text(
                line,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp).semantics { contentDescription = line },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (model.mentionNames.isNotEmpty()) {
            Text(
                model.mentionNames.joinToString(", "),
                modifier = Modifier.padding(horizontal = 24.dp).semantics { contentDescription = "Mentions" },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )
        }
        ChatComposer(
            draft = model.draft,
            onDraft = model::updateDraft,
            sending = model.sending,
            onSend = { model.send(context.applicationContext) }
        )
    }
}

/** Live race line: current mile, track status, and next aid ETA. */
@Composable
private fun ChatStatusHeader(race: MapViewModel?, raceName: String) {
    val colors = MaterialTheme.colorScheme
    val readout = race?.readout
    val next = race?.let { model -> model.aidLiveNext?.let { model.aidPages.getOrNull(it) } }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(colors.primary, CircleShape))
            Kicker(
                "Live runner tracking: mile ${readout?.currentMileLabel ?: "—"}",
                modifier = Modifier.padding(start = 8.dp).weight(1f),
                color = colors.onSurface
            )
            if (!readout?.statusLabel.isNullOrBlank()) {
                StatusChip(readout!!.statusLabel, if (readout.status == "behind") ChipStyle.Filled else ChipStyle.Soft)
            }
        }
        Surface(shape = CircleShape, color = colors.surfaceContainerLowest, shadowElevation = 2.dp) {
            Row(Modifier.padding(horizontal = 24.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Next aid station ETA", style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
                    next?.let {
                        Text(
                            it.title.lowercase().split(" ").joinToString(" ") { word -> word.replaceFirstChar(Char::uppercase) },
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
                Text(
                    next?.let { CrewClock.short(it.arrivalAt) ?: it.clockLabel } ?: "—",
                    style = MetricLargeStyle,
                    color = colors.primary
                )
            }
        }
        // Name the race, never the Stream channel id.
        if (raceName.isNotBlank()) {
            Text(
                raceName,
                modifier = Modifier.semantics { contentDescription = "Race: $raceName" },
                style = MaterialTheme.typography.labelSmall,
                color = colors.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ChatBubble(line: CrewChatMessage) {
    val colors = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth()) {
        if (line.mine) Spacer(Modifier.weight(1f))
        Column(
            Modifier.widthIn(max = 300.dp),
            horizontalAlignment = if (line.mine) Alignment.End else Alignment.Start
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (line.mine && line.time.isNotBlank()) {
                    Text(line.time, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                }
                if (line.author.isNotBlank()) {
                    Kicker(line.author, color = if (line.mine) colors.primary else colors.onSurfaceVariant)
                }
                if (!line.mine && line.time.isNotBlank()) {
                    Text(line.time, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                }
            }
            Surface(
                modifier = Modifier.padding(top = 6.dp),
                shape = RoundedCornerShape(
                    topStart = if (line.mine) 24.dp else 6.dp,
                    topEnd = if (line.mine) 6.dp else 24.dp,
                    bottomStart = 24.dp,
                    bottomEnd = 24.dp
                ),
                color = if (line.mine) colors.primary else colors.surfaceContainerHigh,
                border = if (line.mine) null else BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.6f)),
                shadowElevation = if (line.mine) 3.dp else 0.dp
            ) {
                Column(
                    Modifier
                        .padding(horizontal = 18.dp, vertical = 14.dp)
                        .semantics { contentDescription = line.text.ifBlank { line.author } }
                ) {
                    if (line.text.isNotBlank()) {
                        Text(line.text, style = MaterialTheme.typography.bodyLarge, color = if (line.mine) colors.onPrimary else colors.onSurface)
                    }
                    line.imageUrl?.let { url ->
                        ChatImage(url, Modifier.padding(top = 6.dp).heightIn(max = 180.dp))
                    }
                    if (line.reactions.isNotBlank()) {
                        Text(line.reactions, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
        if (!line.mine) Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun ChatComposer(draft: String, onDraft: (String) -> Unit, sending: Boolean, onSend: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val disabled = sending || draft.isBlank()
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(30.dp),
        color = colors.surfaceContainerLowest,
        border = BorderStroke(1.dp, colors.outlineVariant),
        shadowElevation = 3.dp
    ) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            TextField(
                value = draft,
                onValueChange = onDraft,
                placeholder = { Text("Send update to crew…") },
                maxLines = 4,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                modifier = Modifier.weight(1f).semantics { contentDescription = "Message" }
            )
            FilledIconButton(
                onClick = onSend,
                enabled = !disabled,
                modifier = Modifier.size(48.dp).semantics { contentDescription = "Send" },
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = colors.primary,
                    contentColor = colors.onPrimary,
                    disabledContainerColor = colors.primary.copy(alpha = 0.4f),
                    disabledContentColor = colors.onPrimary
                )
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null)
            }
        }
    }
}
