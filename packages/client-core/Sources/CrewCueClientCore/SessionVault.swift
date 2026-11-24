import Foundation

/// Where the signed-in session (and its access token) lives. Each app backs it with platform
/// secure storage: the Keychain on iOS, an Android Keystore key on Android. This package holds
/// only the contract and the launch-time migration, never a platform call.
public protocol SessionVault: Sendable {
    func load() throws -> ClientSession?
    func save(_ session: ClientSession) throws
    func wipe() throws
}

/// A vault read failed for a reason that may pass on its own (the phone is still locked after a
/// reboot, the Keychain is busy). The stored session is kept, not wiped. A vault throws any other
/// error only when the stored value is unreadable for good.
public struct SessionVaultUnavailable: Error, Equatable {
    public let code: Int32

    public init(code: Int32) {
        self.code = code
    }
}

/// A vault that forgets on relaunch. For tests and dev sessions.
public final class InMemorySessionVault: SessionVault, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: ClientSession?

    public init(_ session: ClientSession? = nil) {
        stored = session
    }

    public func load() throws -> ClientSession? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    public func save(_ session: ClientSession) throws {
        lock.lock()
        stored = session
        lock.unlock()
    }

    public func wipe() throws {
        lock.lock()
        stored = nil
        lock.unlock()
    }
}

/// Launch-time restore of the session from a vault.
///
/// 1. No install marker in the app's storage directory means a fresh install (or a reinstall: a
///    Keychain item outlives app deletion on iOS). The vault is wiped and the marker written.
/// 2. A legacy `session.json` (`SessionFile`) is moved into the vault, then deleted.
/// 3. The vault's session is returned. A `SessionVaultUnavailable` read keeps the stored session;
///    any other read failure (an unreadable value) wipes it.
public enum SessionVaultLaunch {
    public static let markerName = ".session-vault-installed"

    public static func markerURL(directory: URL) -> URL {
        directory.appendingPathComponent(markerName)
    }

    public static func restore(vault: any SessionVault, directory: URL, logger: (any Logger)? = nil) -> ClientSession? {
        resetIfFreshInstall(vault: vault, directory: directory, logger: logger)
        if let migrated = migrateLegacyFile(vault: vault, directory: directory, logger: logger) {
            return migrated
        }
        do {
            return try vault.load()
        } catch let unavailable as SessionVaultUnavailable {
            // Signed out for this launch only: the session is still there for the next one.
            logger?.log("session vault unavailable (\(unavailable.code))")
            return nil
        } catch {
            logger?.log("session vault unreadable")
            try? vault.wipe()
            return nil
        }
    }

    static func resetIfFreshInstall(vault: any SessionVault, directory: URL, logger: (any Logger)?) {
        let marker = markerURL(directory: directory)
        guard !FileManager.default.fileExists(atPath: marker.path) else { return }
        do {
            try vault.wipe()
        } catch {
            logger?.log("session vault reset failed")
        }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data().write(to: marker, options: .atomic)
        } catch {
            logger?.log("session vault marker write failed")
        }
    }

    /// Moves a plaintext `session.json` into the vault. The file is deleted whether or not the
    /// vault accepted it, so no copy stays on disk; the returned session keeps this launch signed in.
    static func migrateLegacyFile(vault: any SessionVault, directory: URL, logger: (any Logger)?) -> ClientSession? {
        guard FileManager.default.fileExists(atPath: SessionFile.url(directory: directory).path) else { return nil }
        let legacy = try? SessionFile.load(directory: directory)
        if let legacy {
            do {
                try vault.save(legacy)
            } catch {
                logger?.log("session vault migration save failed")
            }
        }
        do {
            try SessionFile.wipe(directory: directory)
        } catch {
            logger?.log("legacy session file delete failed")
        }
        return legacy
    }
}
