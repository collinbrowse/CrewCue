// CrewCue Chat FCM Service (Phase 6 — issue #230)
//
// Receives encrypted FCM data payloads, decrypts the message body using a
// channel key cached in EncryptedSharedPreferences, and posts a notification.
// Falls back to the generic body if decryption is not possible.

package com.crewcue.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.libsodium.jni.SodiumConstants
import org.libsodium.jni.crypto.SecretBox
import java.util.Base64

class ChatMessagingService : FirebaseMessagingService() {

    private val genericFallback = "New Message in Crew Chat"
    private val notifChannelId = "crewcue.chat"
    private val keyPrefName = "crewcue.chat.keys"

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        val channelId = data["channelId"]
        val ciphertextB64 = data["ciphertext"]
        val nonceB64 = data["nonce"]

        val body = decryptOrFallback(channelId, ciphertextB64, nonceB64)
        ensureChannel()
        val builder = NotificationCompat.Builder(this, notifChannelId)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("CrewCue")
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(channelId?.hashCode() ?: 0, builder.build())
    }

    private fun decryptOrFallback(
        channelId: String?,
        ciphertextB64: String?,
        nonceB64: String?
    ): String {
        if (channelId == null || ciphertextB64 == null || nonceB64 == null) {
            return genericFallback
        }
        return try {
            val key = loadChannelKey(channelId) ?: return genericFallback
            val ciphertext = Base64.getDecoder().decode(ciphertextB64)
            val nonce = Base64.getDecoder().decode(nonceB64)
            val plaintext = SecretBox(key).decrypt(nonce, ciphertext)
            String(plaintext, Charsets.UTF_8)
        } catch (e: Throwable) {
            genericFallback
        }
    }

    private fun loadChannelKey(channelId: String): ByteArray? {
        val masterKey = MasterKey.Builder(this)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val prefs = EncryptedSharedPreferences.create(
            this,
            keyPrefName,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        val b64 = prefs.getString("channel.$channelId", null) ?: return null
        return Base64.getDecoder().decode(b64)
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(notifChannelId) == null) {
            val channel = NotificationChannel(
                notifChannelId,
                "Crew chat",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            nm.createNotificationChannel(channel)
        }
    }
}
