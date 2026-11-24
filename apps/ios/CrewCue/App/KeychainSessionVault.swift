import Foundation
import Security
import CrewCueClientCore

/// The signed-in session as one generic-password Keychain item. Readable after the first unlock
/// so background location pings still have the token while the phone is locked; this-device-only
/// and not synchronizable, so it never leaves the phone through iCloud Keychain or a backup.
struct KeychainSessionVault: SessionVault {
    struct Failure: Error {
        let status: OSStatus
    }

    let service: String
    let account: String

    init(service: String = Bundle.main.bundleIdentifier ?? "com.crewcue.ios", account: String = "session") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
    }

    func load() throws -> ClientSession? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        // A Keychain status (locked before first unlock, busy) says nothing about the item, so it
        // is kept. Only data that does not decode is unreadable for good.
        guard status == errSecSuccess else { throw SessionVaultUnavailable(code: status) }
        guard let data = result as? Data else { throw Failure(status: status) }
        return try JSONDecoder().decode(ClientSession.self, from: data)
    }

    func save(_ session: ClientSession) throws {
        let data = try JSONEncoder().encode(session)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw Failure(status: status) }
        var item = query
        item.merge(attributes) { _, new in new }
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { throw Failure(status: added) }
    }

    func wipe() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
    }
}
