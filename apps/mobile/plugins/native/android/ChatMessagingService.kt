// CrewCue Chat FCM Service (Phase 6 — issue #230)
//
// Receives encrypted FCM data payloads, decrypts the message body using a
// channel key cached in EncryptedSharedPreferences, and posts a notification.
// Falls back to the generic body if decryption is not possible.
//
// Cipher must match the JS side (apps/mobile/src/features/chat/crypto.ts):
// XSalsa20-Poly1305 (libsodium `crypto_secretbox`). We use lazysodium-android
// which gives us the matching primitive in pure Java/Kotlin.
//
// Add to apps/mobile/android/app/build.gradle after `expo prebuild`:
//
//     implementation "com.goterl:lazysodium-android:5.1.0@aar"
//     implementation "net.java.dev.jna:jna:5.13.0@aar"
//     implementation "androidx.security:security-crypto:1.1.0-alpha06"
//
// Phase 6 ships this file alongside the config plugin so it's version
// controlled. The plugin copies it into the generated Android source set
// during `expo prebuild`.

package com.crewcue.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.goterl.lazysodium.interfaces.SecretBox
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class ChatMessagingService : FirebaseMessagingService() {

    private val genericFallback = "New Message in Crew Chat"
    private val notifChannelId = "crewcue.chat"
    private val keyPrefName = "crewcue.chat.keys"
    private val sodium: LazySodiumAndroid by lazy { LazySodiumAndroid(SodiumAndroid()) }

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
            val ciphertext = Base64.decode(ciphertextB64, Base64.DEFAULT)
            val nonce = Base64.decode(nonceB64, Base64.DEFAULT)
            // tweetnacl secretbox encrypts as (tag || ct). lazysodium's
            // SecretBox.Native.cryptoSecretBoxOpenEasy expects exactly that.
            val plaintext = ByteArray(ciphertext.size - SecretBox.MACBYTES)
            val ok = (sodium as SecretBox.Native).cryptoSecretBoxOpenEasy(
                plaintext,
                ciphertext,
                ciphertext.size.toLong(),
                nonce,
                key
            )
            if (ok) String(plaintext, Charsets.UTF_8) else genericFallback
        } catch (_: Throwable) {
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
        return Base64.decode(b64, Base64.DEFAULT)
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
