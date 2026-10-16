import Foundation

/// Every per-user file (outbox, ping order, room caches, drafts) lives under `root/users/<id>`.
/// The ids can be listed, so sign-out, session expiry, and a sign-in as someone else can wipe
/// all of them and a second account never reads or drains the first account's queue.
public struct UserStorage: Sendable {
    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    public var usersDirectory: URL {
        root.appendingPathComponent("users", isDirectory: true)
    }

    /// The user's directory, created if needed. The id is percent-encoded, so it round-trips through `userIds()`.
    public func directory(userId: String) throws -> URL {
        let directory = location(userId: userId)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    public func userIds() throws -> [String] {
        guard FileManager.default.fileExists(atPath: usersDirectory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(atPath: usersDirectory.path)
            .compactMap { $0.removingPercentEncoding }
            .sorted()
    }

    /// Closes the user's open outbox, then removes the whole directory.
    public func wipe(userId: String) throws {
        let directory = location(userId: userId)
        try OutboxStore.wipeShared(inside: directory)
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }

    /// Wipes every listed user, optionally keeping one. Every user is attempted; the first error is rethrown.
    public func wipeAll(except keep: String? = nil) throws {
        var firstError: (any Error)?
        for userId in try userIds() where userId != keep {
            do {
                try wipe(userId: userId)
            } catch {
                firstError = firstError ?? error
            }
        }
        if let firstError {
            throw firstError
        }
    }

    private func location(userId: String) -> URL {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.isEmpty ? "guest" : trimmed
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_")
        let encoded = name.addingPercentEncoding(withAllowedCharacters: allowed) ?? "guest"
        return usersDirectory.appendingPathComponent(encoded, isDirectory: true)
    }
}

/// Wraps a transport and reports an authorized request that came back 401. Every API 401 means
/// the session is no longer valid; the app answers with the same wipe as sign-out.
public struct SessionExpiryTransport: HTTPTransport {
    private let inner: any HTTPTransport
    private let onExpired: @Sendable () -> Void

    public init(wrapping inner: any HTTPTransport, onExpired: @escaping @Sendable () -> Void) {
        self.inner = inner
        self.onExpired = onExpired
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let response = try await inner.send(request)
        if response.status == 401, request.headers["Authorization"] != nil {
            onExpired()
        }
        return response
    }
}
