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
// IMPORTANT: This file ships in `apps/mobile/plugins/native/ios/` so it is
// version-controlled alongside the config plugin. The Phase 6 prebuild step
// copies it into the generated NSE Xcode target.

import UserNotifications
import CryptoKit

final class NotificationService: UNNotificationServiceExtension {
    private static let appGroupId = "group.com.crewcue.mobile.chat"
    private static let keyPrefix = "crewcue.chat.channelKey."
    private static let genericFallback = "New Message in Crew Chat"

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

        do {
            let nonceObj = try ChaChaPoly.Nonce(data: nonce)
            let sealedBox = try ChaChaPoly.SealedBox(combined: nonceObj + ciphertext)
            let plaintext = try ChaChaPoly.open(sealedBox, using: SymmetricKey(data: key))
            if let body = String(data: plaintext, encoding: .utf8), !body.isEmpty {
                content.body = body
            } else {
                content.body = Self.genericFallback
            }
        } catch {
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
