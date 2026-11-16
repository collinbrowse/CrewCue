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

/** Crew chat push on Android: FCM token registration, the notification channel, and tap routing. */
object CrewPush {
    /** Matches `FCM_CHAT_CHANNEL_ID` in the API. */
    const val CHANNEL_ID = "crew_chat"
    const val EXTRA_TYPE = "type"
    const val EXTRA_ROOM_ID = "roomId"

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

    /** Re-registers silently when notifications are already allowed (tokens rotate). Blocking. */
    fun refreshIfAllowed(context: Context, raceDay: RaceDayBridge) {
        if (!notificationsAllowed(context)) return
        val token = tokenOrNull(context) ?: return
        register(context, raceDay, token)
    }

    /** Room id a tapped chat notification carries, or null. */
    fun chatRoomFrom(intent: Intent?): String? {
        val extras = intent?.extras ?: return null
        val type = extras.getString(EXTRA_TYPE)
        if (type != null && type != "chat") return null
        return extras.getString(EXTRA_ROOM_ID)?.takeIf { it.isNotBlank() }
    }

    fun show(context: Context, title: String, body: String, roomId: String, messageId: String?) {
        if (!notificationsAllowed(context)) return
        ensureChannel(context)
        val tap = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_TYPE, "chat")
            putExtra(EXTRA_ROOM_ID, roomId)
        }
        val pending = PendingIntent.getActivity(
            context,
            roomId.hashCode(),
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
            NotificationManagerCompat.from(context).notify(roomId, (messageId ?: roomId).hashCode(), notification)
        }
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
        val roomId = message.data[CrewPush.EXTRA_ROOM_ID] ?: return
        if (message.data[CrewPush.EXTRA_TYPE] != "chat") return
        val title = message.notification?.title ?: "Crew chat"
        val body = message.notification?.body ?: "New Message in Crew Chat"
        CrewPush.show(applicationContext, title, body, roomId, message.data["messageId"])
    }
}
