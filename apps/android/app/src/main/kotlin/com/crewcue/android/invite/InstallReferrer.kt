package com.crewcue.android.invite

import android.content.Context
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/** What one read of the Play install referrer came to. */
sealed interface ReferrerRead {
    /** Play answered: [referrer] is its string (`utm_source=…&crewcue_join=123456`), or blank. */
    data class Answered(val referrer: String) : ReferrerRead
    /** Play can never answer here (no Play Store, an old one, a sideloaded install). */
    data object Unsupported : ReferrerRead
    /** Play couldn't answer this time (service down or disconnected): try again next launch. */
    data object TryLater : ReferrerRead
}

/**
 * Where the install referrer comes from. The Play Store's in the app ([PlayInstallReferrer]); a
 * debug launch extra or a test can fake it ([FakeInstallReferrer]).
 */
fun interface InstallReferrerSource {
    suspend fun read(): ReferrerRead
}

/** The string a debug launch handed in (`--es crewcueFakeReferrer 'crewcue_join=123456'`). */
class FakeInstallReferrer(private val referrer: String) : InstallReferrerSource {
    override suspend fun read(): ReferrerRead = ReferrerRead.Answered(referrer)
}

/** Whether this install's referrer was already read. A file flag, so a JVM test can use a fake. */
interface ReferrerOnce {
    fun isDone(): Boolean
    fun markDone()
}

class PrefsReferrerOnce(context: Context) : ReferrerOnce {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    override fun isDone(): Boolean = prefs.getBoolean(KEY_DONE, false)
    override fun markDone() {
        prefs.edit().putBoolean(KEY_DONE, true).apply()
    }

    private companion object {
        // Not the session's prefs: sign-out clears those, and the referrer is read once per install.
        const val PREFS = "crewcue.install-referrer"
        const val KEY_DONE = "read"
    }
}

/**
 * Reads the install referrer once per install, on the first launch Play can answer, and hands
 * back the raw string for client-core to parse (`InviteLink` reads `crewcue_join=<code>`). A launch
 * where Play couldn't answer tries again next launch; one where it never can gives up.
 */
class InstallReferrerCheck(
    private val source: InstallReferrerSource,
    private val once: ReferrerOnce
) {
    private val running = AtomicBoolean(false)

    /** The referrer string the first time Play answers; null on every other call. */
    suspend fun firstReferrer(): String? {
        if (once.isDone() || !running.compareAndSet(false, true)) return null
        try {
            return when (val read = runCatching { source.read() }.getOrDefault(ReferrerRead.TryLater)) {
                is ReferrerRead.Answered -> {
                    once.markDone()
                    read.referrer.ifBlank { null }
                }
                ReferrerRead.Unsupported -> {
                    once.markDone()
                    null
                }
                ReferrerRead.TryLater -> null
            }
        } finally {
            running.set(false)
        }
    }
}

/** The Play Install Referrer library: connect, read once, disconnect. */
class PlayInstallReferrer(context: Context) : InstallReferrerSource {
    private val appContext = context.applicationContext

    override suspend fun read(): ReferrerRead = suspendCancellableCoroutine { continuation ->
        val client = InstallReferrerClient.newBuilder(appContext).build()
        val answered = AtomicBoolean(false)
        fun finish(read: ReferrerRead) {
            if (!answered.compareAndSet(false, true)) return
            runCatching { client.endConnection() }
            if (continuation.isActive) continuation.resume(read)
        }
        try {
            client.startConnection(object : InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(responseCode: Int) {
                    when (responseCode) {
                        InstallReferrerClient.InstallReferrerResponse.OK -> finish(
                            runCatching { ReferrerRead.Answered(client.installReferrer.installReferrer.orEmpty()) }
                                .getOrDefault(ReferrerRead.TryLater)
                        )
                        InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED,
                        InstallReferrerClient.InstallReferrerResponse.DEVELOPER_ERROR,
                        InstallReferrerClient.InstallReferrerResponse.PERMISSION_ERROR -> finish(ReferrerRead.Unsupported)
                        else -> finish(ReferrerRead.TryLater)
                    }
                }

                override fun onInstallReferrerServiceDisconnected() {
                    finish(ReferrerRead.TryLater)
                }
            })
        } catch (_: Throwable) {
            // No Play Store at all: the library throws before it can call back.
            finish(ReferrerRead.Unsupported)
        }
        continuation.invokeOnCancellation { runCatching { client.endConnection() } }
    }
}
