package com.crewcue.android.ui.invite

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle
import com.crewcue.android.ui.theme.SecondaryButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** The invite screen's test tag, the `invite-share` checklist's. */
const val INVITE_SHARE_TAG = "crewcue.invite-share"

/** client-core's `InviteCopy` lines (the `inviteCopy` op's `copy`), by name. */
data class InviteText(private val lines: Map<String, String>) {
    operator fun get(key: String): String = lines[key].orEmpty()

    val shareTitle get() = this["shareTitle"]
    val shareDetail get() = this["shareDetail"]
    val shareReady get() = this["shareReady"]
    val shareEmpty get() = this["shareEmpty"]
    val shareError get() = this["shareError"]
    val shareOffline get() = this["shareOffline"]
    val shareLocked get() = this["shareLocked"]
    val shareButton get() = this["shareButton"]
    val copyCode get() = this["copyCode"]
    val codeCopied get() = this["codeCopied"]
    val codeLabel get() = this["codeLabel"]
    val linkLabel get() = this["linkLabel"]
    val linkWithoutCode get() = this["linkWithoutCode"]
    val pasteLabel get() = this["pasteLabel"]
    val pasteNoCode get() = this["pasteNoCode"]
    val signUpToJoin get() = this["signUpToJoin"]
    val signUpToJoinDetail get() = this["signUpToJoinDetail"]
    val joinTitle get() = this["joinTitle"]
    val joinPrompt get() = this["joinPrompt"]
    val joinEmpty get() = this["joinEmpty"]
    val joinReady get() = this["joinReady"]
    val joinPreviewOffline get() = this["joinPreviewOffline"]
    val joinNotFound get() = this["joinNotFound"]
    val joinButton get() = this["joinButton"]
    val inviteCrewButton get() = this["inviteCrewButton"]
    val backToMembers get() = this["backToMembers"]

    companion object {
        fun from(copy: JSONObject?): InviteText {
            val lines = mutableMapOf<String, String>()
            copy?.keys()?.forEach { key -> lines[key] = copy.optText(key) }
            return InviteText(lines)
        }
    }
}

/** client-core's `inviteShare` answer (`InviteCopy.shareDetails`): the screen's state and invite. */
data class InviteShare(
    val state: InviteState,
    /** The line under the title: ready (or the locked note), empty, error or offline. */
    val status: String,
    val code: String?,
    val link: String?,
    val text: String?,
    val locked: Boolean
) {
    /** Something to share: a valid code with its link and text. */
    val shareable: Boolean get() = state == InviteState.Ready && code != null && link != null && text != null

    companion object {
        /** A failed bridge call reads as an error (`InviteCopy.shareError`). */
        fun from(json: JSONObject?, errorLine: String = ""): InviteShare {
            val details = json?.optJSONObject("details")
            fun field(key: String) = details?.optText(key)?.trim()?.ifEmpty { null }
            val state = when (json?.optText("state")) {
                "ready" -> InviteState.Ready
                "empty" -> InviteState.Empty
                "offline" -> InviteState.Offline
                else -> InviteState.Error
            }
            return InviteShare(
                state = state,
                status = json?.optText("status")?.ifBlank { null } ?: errorLine,
                code = field("code"),
                link = field("link"),
                text = field("shareText"),
                locked = details?.optBoolean("locked") == true
            )
        }
    }
}

/** The invite screen's checklist state. */
enum class InviteState { Loading, Ready, Empty, Error, Offline }

/** Builds the race's invite through client-core (`inviteShare`: the room read and its details). */
class InviteShareViewModel(private val raceDay: RaceDayBridge, private val roomId: String) : ViewModel() {
    var share by mutableStateOf<InviteShare?>(null)
        private set
    var copied by mutableStateOf(false)
        private set

    fun load(errorLine: String) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { raceDay.inviteShare(roomId) }
            share = InviteShare.from((result as? RuntimeResult.Success)?.result, errorLine)
        }
    }

    fun noteCopied() {
        copied = true
    }
}

class InviteShareViewModelFactory(private val raceDay: RaceDayBridge, private val roomId: String) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = InviteShareViewModel(raceDay, roomId) as T
}

/**
 * The runner's invite (Room members → Invite crew): the 6-digit code, the join link, Share invite
 * (the Android share sheet with client-core's share text) and Copy code. An unpaid race says crew
 * can join once it is unlocked.
 */
@Composable
fun InviteShareScreen(shell: ShellViewModel, roomId: String, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val text = shell.inviteText
    val model: InviteShareViewModel = viewModel(
        key = "invite-$roomId",
        factory = InviteShareViewModelFactory(shell.container.raceDay, roomId)
    )
    val context = LocalContext.current
    LaunchedEffect(roomId) { model.load(text.shareError) }
    // client-core's line: ready or the locked note, empty, error or offline; Copy code says copied.
    val status = if (model.copied) text.codeCopied else model.share?.status.orEmpty()
    Column(
        modifier
            .fillMaxSize()
            .testTag(INVITE_SHARE_TAG)
            .semantics { contentDescription = text.shareTitle }
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        ProductTitle(text.shareTitle, text.shareDetail)
        if (model.share == null) {
            CircularProgressIndicator(
                modifier = Modifier
                    .padding(top = 16.dp)
                    .testTag("$INVITE_SHARE_TAG.loading")
                    .semantics { contentDescription = "Loading" }
            )
        }
        if (status.isNotBlank()) {
            Text(status, modifier = Modifier.padding(top = 12.dp).semantics { contentDescription = status })
        }
        val share = model.share?.takeIf { it.shareable }
        if (share != null) {
            ProductCard(Modifier.padding(top = 16.dp)) {
                Text(text.codeLabel, style = MaterialTheme.typography.labelLarge)
                SelectionContainer {
                    Text(
                        share.code.orEmpty(),
                        modifier = Modifier
                            .testTag("$INVITE_SHARE_TAG.code")
                            .semantics { contentDescription = "${text.codeLabel} ${share.code.orEmpty()}" },
                        style = MaterialTheme.typography.displaySmall,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold
                    )
                }
                Text(text.linkLabel, modifier = Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelLarge)
                SelectionContainer {
                    Text(
                        share.link.orEmpty(),
                        modifier = Modifier.testTag("$INVITE_SHARE_TAG.link"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            PrimaryButton(
                text.shareButton,
                onClick = { openShareSheet(context, share, text.shareTitle) },
                modifier = Modifier.padding(top = 16.dp).testTag("$INVITE_SHARE_TAG.share")
            )
            SecondaryButton(
                text.copyCode,
                onClick = {
                    copyCode(context, share.code.orEmpty(), text.codeLabel)
                    model.noteCopied()
                },
                modifier = Modifier.padding(top = 12.dp).testTag("$INVITE_SHARE_TAG.copy")
            )
        }
        SecondaryButton(text.backToMembers, onClick = onBack, modifier = Modifier.padding(top = 12.dp))
    }
}

/** The Android share sheet with the invite's text (the link, and the code as a fallback). */
fun shareInviteIntent(share: InviteShare, title: String): Intent? {
    val text = share.text ?: return null
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TEXT, text)
        .putExtra(Intent.EXTRA_SUBJECT, title)
    return Intent.createChooser(send, title)
}

private fun openShareSheet(context: Context, share: InviteShare, title: String) {
    val intent = shareInviteIntent(share, title) ?: return
    if (context !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No app can share text: the code and link stay on screen to copy.
    }
}

private fun copyCode(context: Context, code: String, label: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText(label, code))
}
