// CrewCue Chat Notification Service Extension (Phase 6 — issue #230)
//
// Receives encrypted push payloads from APNS, decrypts the message body using
// a channel key cached in the shared App Group keychain, and updates the
// notification body before delivery to the OS.
//
// On any failure (missing key, decrypt error, timeout) the OS falls back to
// the original generic body (`New Message in Crew Chat`) provided by the
// server-side push fan-out webhook in services/api.
//
// The cipher used here MUST match the JS side (apps/mobile/src/features/chat/
// crypto.ts). We use libsodium `crypto_secretbox_xsalsa20poly1305` via
// swift-sodium so the NSE can open a payload produced by tweetnacl's
// `nacl.secretbox`.
//
// Add to the iOS Podfile after running `expo prebuild`:
//
//     target 'ChatNotificationServiceExtension' do
//       use_frameworks!
//       pod 'Sodium', '~> 0.9'
//     end
//
// Phase 6 ships this file alongside the config plugin so it's version
// controlled. The plugin copies it into the generated NSE target during
// `expo prebuild`.

import UserNotifications
import Sodium

final class NotificationService: UNNotificationServiceExtension {
    private static let appGroupId = "group.com.crewcue.mobile.chat"
    private static let keyPrefix = "crewcue.chat.channelKey."
    private static let genericFallback = "New Message in Crew Chat"

    private let sodium = Sodium()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        self.bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let content = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        guard
            let userInfo = request.content.userInfo as? [String: Any],
            let channelId = userInfo["channelId"] as? String,
            let ciphertextB64 = userInfo["ciphertext"] as? String,
            let nonceB64 = userInfo["nonce"] as? String,
            let key = Self.loadChannelKey(channelId: channelId),
            let ciphertext = Data(base64Encoded: ciphertextB64),
            let nonce = Data(base64Encoded: nonceB64)
        else {
            content.body = Self.genericFallback
            contentHandler(content)
            return
        }

        // tweetnacl's secretbox returns ciphertext that is the concatenation
        // of (poly1305 tag || encrypted bytes), with the nonce supplied
        // separately. swift-sodium's `secretBox.open(authenticatedCipherText:
        // secretKey:nonce:)` accepts exactly that shape.
        if let plaintextBytes = sodium.secretBox.open(
            authenticatedCipherText: Bytes(ciphertext),
            secretKey: Bytes(key),
            nonce: Bytes(nonce)
        ), let body = String(bytes: plaintextBytes, encoding: .utf8), !body.isEmpty {
            content.body = body
        } else {
            content.body = Self.genericFallback
        }

        contentHandler(content)
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            bestAttemptContent.body = Self.genericFallback
            contentHandler(bestAttemptContent)
        }
    }

    private static func loadChannelKey(channelId: String) -> Data? {
        let account = "\(keyPrefix)\(channelId)"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccessGroup as String: appGroupId,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return data
    }
}
