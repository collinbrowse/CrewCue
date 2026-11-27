package com.crewcue.android.ui.chat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.crewcue.android.MainActivity
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.di.AppContainer
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.UUID
import java.util.concurrent.TimeUnit

/** CrewCue push on Android: FCM token registration, the notification channel, and the tapped payload. */
object CrewPush {
    /** Matches `FCM_CHAT_CHANNEL_ID` in the API. */
    const val CHANNEL_ID = "crew_chat"
    const val EXTRA_TYPE = "type"
    const val EXTRA_ROOM_ID = "roomId"
    private const val DEV_SESSION_EXTRA = "devSession"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Crew chat", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Messages from your crew"
            }
        )
    }

    fun notificationsAllowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    /** The FCM token, or null when Firebase is not configured (no google-services.json) or unreachable. */
    fun tokenOrNull(context: Context): String? {
        if (FirebaseApp.getApps(context).isEmpty()) return null
        return runCatching {
            Tasks.await(FirebaseMessaging.getInstance().token, 15, TimeUnit.SECONDS)?.trim()?.ifBlank { null }
        }.getOrNull()
    }

    fun deviceId(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        if (!androidId.isNullOrBlank()) return androidId
        val prefs = context.getSharedPreferences("crewcue.push", Context.MODE_PRIVATE)
        prefs.getString("deviceId", null)?.takeIf { it.isNotBlank() }?.let { return it }
        val created = UUID.randomUUID().toString()
        prefs.edit().putString("deviceId", created).apply()
        return created
    }

    /** Queues [token] for `/chat/push/tokens` and flushes. Blocking; call off the main thread. */
    fun register(context: Context, raceDay: RaceDayBridge, token: String): RuntimeResult {
        val queued = raceDay.enqueuePush(deviceId(context), token)
        if (queued is RuntimeResult.Failure) return queued
        return raceDay.flushOutbox()
    }

    /**
     * Sign-out: this phone stops getting the signed-out account's pushes. First the API drops the
     * account's row for this device ([sessionToken] is the signed-out session's), then the FCM
     * token itself is deleted, so a row the API kept (offline) points at a dead token that FCM
     * rejects. The next sign-in registers a fresh token. Best effort and blocking; call off the
     * main thread, after the session is cleared ([CrewCueMessagingService.onNewToken] registers
     * nothing while signed out).
     */
    fun unregister(context: Context, raceDay: RaceDayBridge, sessionToken: String) {
        raceDay.unregisterPushDevice(deviceId(context), sessionToken)
        if (FirebaseApp.getApps(context).isEmpty()) return
        runCatching { Tasks.await(FirebaseMessaging.getInstance().deleteToken(), 15, TimeUnit.SECONDS) }
    }

    /** Re-registers silently when notifications are already allowed (tokens rotate). Blocking. */
    fun refreshIfAllowed(context: Context, raceDay: RaceDayBridge) {
        if (!notificationsAllowed(context)) return
        val token = tokenOrNull(context) ?: return
        register(context, raceDay, token)
    }

    /**
     * The push payload a tapped notification carries in [intent]'s extras: the API's FCM `data`
     * keys (the system copies them into the launch intent for a notification it showed) or the
     * ones [show] puts in its PendingIntent. Null for any other launch.
     */
    fun tapPayloadFrom(intent: Intent?): PushTapPayload? {
        val extras = intent?.extras ?: return null
        // A debug dev-session launch carries its own `roomId` extra (DevSession); it isn't a tap.
        if (extras.containsKey(DEV_SESSION_EXTRA)) return null
        @Suppress("DEPRECATION")
        return PushTapPayload.from { key -> if (extras.containsKey(key)) extras.get(key) else null }
    }

    /**
     * A notification for a push that arrived in the foreground. A tap opens MainActivity with the
     * same `type` and `roomId` extras a system-shown FCM notification carries.
     */
    fun show(context: Context, title: String, body: String, payload: PushTapPayload, messageId: String?) {
        if (!notificationsAllowed(context)) return
        val roomId = payload.roomId as? String ?: return
        ensureChannel(context)
        val tap = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtras(payload.extras())
        }
        // One PendingIntent per kind and race, so an unlock tap never reuses a chat tap's extras.
        val pending = PendingIntent.getActivity(
            context,
            "${payload.type}:$roomId".hashCode(),
            tap,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        runCatching {
            NotificationManagerCompat.from(context).notify(roomId, (messageId ?: "${payload.type}:$roomId").hashCode(), notification)
        }
    }
}

/**
 * The `type` and `roomId` a tapped notification carries, as read from its extras. Values stay
 * as found: client-core `PushTapRoute` (the `pushTapReceive` op) decides what routes, including
 * a value that isn't a string.
 */
data class PushTapPayload(val type: Any?, val roomId: Any?) {
    /** The extras a locally built notification's tap carries. */
    fun extras(): android.os.Bundle = android.os.Bundle().apply {
        (type as? String)?.let { putString(CrewPush.EXTRA_TYPE, it) }
        (roomId as? String)?.let { putString(CrewPush.EXTRA_ROOM_ID, it) }
    }

    companion object {
        /** Null unless [get] has a `roomId` or `type`: an ordinary launch, not a notification tap. */
        fun from(get: (String) -> Any?): PushTapPayload? {
            val type = get(CrewPush.EXTRA_TYPE)
            val roomId = get(CrewPush.EXTRA_ROOM_ID)
            if (type == null && roomId == null) return null
            return PushTapPayload(type, roomId)
        }

        /** An FCM message's `data` map (all strings). */
        fun from(data: Map<String, String>): PushTapPayload? = from { data[it] }
    }
}

/**
 * FCM entry point. In the background the system shows the API's notification and a tap opens
 * MainActivity with the data keys as extras; in the foreground this service shows it.
 */
class CrewCueMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val container = AppContainer(applicationContext)
        if (container.sessionStore.current() == null) return
        CrewPush.register(applicationContext, container.raceDay, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Every kind the API sends (chat, tracking, unlock, schedule) shows; the tap decides what opens.
        val payload = PushTapPayload.from(message.data) ?: return
        if (payload.roomId == null) return
        val chat = (payload.type ?: "chat") == "chat"
        val title = message.notification?.title ?: if (chat) "Crew chat" else "CrewCue"
        val body = message.notification?.body ?: if (chat) "New Message in Crew Chat" else return
        CrewPush.show(applicationContext, title, body, payload, message.data["messageId"])
    }
}
