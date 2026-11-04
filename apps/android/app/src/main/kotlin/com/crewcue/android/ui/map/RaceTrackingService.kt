package com.crewcue.android.ui.map

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.content.ContextCompat
import com.crewcue.android.MainActivity
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.di.AppContainer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * The runner's race-day location source. A location foreground service (ongoing notification) keeps
 * sampling with the screen off: one fix per interval from the saved `TrackingSettings`, queued in
 * the client-core outbox and flushed as one batch whenever the phone has service. It starts only
 * after the athlete taps Start tracking and resumes from the saved `TrackingSession` (START_STICKY).
 */
class RaceTrackingService : Service(), LocationListener {
    private val container by lazy { AppContainer(applicationContext) }
    private val raceDay: RaceDayBridge get() = container.raceDay
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val enqueueLock = Mutex()
    private var roomId: String? = null
    private var intervalMs = DEFAULT_INTERVAL_MS
    private var lastKeptAt = 0L
    private var lastRecordedMillis = 0L
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val recordedAtFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            // The notification's Stop: clear the saved session so a restart doesn't resume it.
            scope.launch {
                raceDay.stopTrackingSession()
                stopSelf()
            }
            return START_NOT_STICKY
        }
        // Foreground first: Android requires it within seconds of startForegroundService.
        startInForeground()
        scope.launch {
            val session = (raceDay.trackingSession() as? RuntimeResult.Success)?.result
            val room = session?.takeIf { it.optBoolean("active") }?.optString("roomId")?.ifBlank { null }
            if (room == null) {
                stopSelf()
                return@launch
            }
            val seconds = (raceDay.trackingSettings() as? RuntimeResult.Success)?.result?.optInt("intervalSeconds", 0) ?: 0
            intervalMs = if (seconds > 0) seconds * 1000L else DEFAULT_INTERVAL_MS
            roomId = room
            ContextCompat.getMainExecutor(this@RaceTrackingService).execute { beginUpdates() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        getSystemService(LocationManager::class.java)?.removeUpdates(this)
        networkCallback?.let { callback ->
            runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(callback) }
        }
        networkCallback = null
        scope.cancel()
        super.onDestroy()
    }

    @SuppressLint("MissingPermission")
    private fun beginUpdates() {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val manager = getSystemService(LocationManager::class.java)
        if (!granted || manager == null) {
            stopSelf()
            return
        }
        manager.removeUpdates(this)
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).forEach { provider ->
            if (runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false)) {
                // minTime spaces deliveries; the interval check below keeps exactly one per interval.
                manager.requestLocationUpdates(provider, intervalMs, 0f, this, Looper.getMainLooper())
            }
        }
        watchNetwork()
    }

    /** Sends the backlog the moment the phone gets service back. */
    private fun watchNetwork() {
        if (networkCallback != null) return
        val manager = getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                scope.launch { raceDay.flushOutbox() }
            }
        }
        runCatching { manager.registerDefaultNetworkCallback(callback) }.onSuccess { networkCallback = callback }
    }

    override fun onLocationChanged(location: Location) {
        val room = roomId ?: return
        // GPS and network both deliver; keep one fix per interval, stamped with the fix's own time.
        if (lastKeptAt != 0L && location.time - lastKeptAt < intervalMs) return
        lastKeptAt = location.time
        val latitude = location.latitude
        val longitude = location.longitude
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        val fixTime = location.time
        scope.launch {
            enqueueLock.withLock {
                val queued = raceDay.enqueuePing(room, latitude, longitude, recordedAt(fixTime), accuracy)
                if (queued is RuntimeResult.Failure && queued.message.contains("increase")) {
                    raceDay.enqueuePing(room, latitude, longitude, recordedAt(System.currentTimeMillis()), accuracy)
                }
            }
            raceDay.flushOutbox()
            // Stop once the server reports the finish crossed.
            val live = raceDay.liveProjection(room)
            if (live is RuntimeResult.Success && live.result.optBoolean("finishCrossed")) {
                raceDay.stopTrackingSession()
                stopSelf()
            }
        }
    }

    @Deprecated("Required on API < 29")
    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) = Unit

    private fun recordedAt(fixMillis: Long): String {
        var millis = fixMillis
        if (millis <= lastRecordedMillis) millis = lastRecordedMillis + 1
        lastRecordedMillis = millis
        return recordedAtFormat.format(millis)
    }

    private fun startInForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager?.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Race tracking", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while CrewCue shares your position with your crew."
                }
            )
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, RaceTrackingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Sharing your position with your crew")
            .setContentText("CrewCue sends a sample every few minutes until the finish.")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "crewcue.tracking"
        private const val NOTIFICATION_ID = 4101
        private const val ACTION_STOP = "com.crewcue.android.tracking.STOP"
        private const val DEFAULT_INTERVAL_MS = 180_000L

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, RaceTrackingService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RaceTrackingService::class.java))
        }
    }
}
