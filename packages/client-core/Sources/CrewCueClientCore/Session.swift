import Foundation

public struct ClientSession: Codable, Equatable, Sendable {
    public var userId: String
    public var role: String
    public var roomId: String?
    public var displayName: String?
    public var accessToken: String?

    public init(userId: String, role: String, roomId: String? = nil, displayName: String? = nil, accessToken: String? = nil) {
        self.userId = userId
        self.role = role
        self.roomId = roomId
        self.displayName = displayName
        self.accessToken = accessToken
    }
}

public protocol UserDataStore: Sendable {
    func wipe() throws
}

public final class SessionController: @unchecked Sendable {
    private let lock = NSLock()
    private var wipers: [String: @Sendable () throws -> Void] = [:]
    public private(set) var session: ClientSession?

    public init(session: ClientSession? = nil) {
        self.session = session
    }

    public func adopt(_ session: ClientSession) {
        lock.lock()
        self.session = session
        lock.unlock()
    }

    public func update(_ mutate: (inout ClientSession) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard var current = session else { return }
        mutate(&current)
        session = current
    }

    /// Register a per-user store. Sign-out and session expiry call every wiper.
    public func register(id: String, wipe: @escaping @Sendable () throws -> Void) {
        lock.lock()
        wipers[id] = wipe
        lock.unlock()
    }

    public func signOut() throws {
        let hooks: [@Sendable () throws -> Void]
        lock.lock()
        hooks = Array(wipers.values)
        session = nil
        lock.unlock()
        for hook in hooks {
            try hook()
        }
    }
}

public enum SessionFile {
    public static func url(directory: URL) -> URL {
        directory.appendingPathComponent("session.json")
    }

    public static func load(directory: URL) throws -> ClientSession? {
        let file = url(directory: directory)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return try JSONDecoder().decode(ClientSession.self, from: Data(contentsOf: file))
    }

    public static func save(_ session: ClientSession, directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(session)
        try data.write(to: url(directory: directory), options: .atomic)
    }

    public static func wipe(directory: URL) throws {
        let file = url(directory: directory)
        if FileManager.default.fileExists(atPath: file.path) {
            try FileManager.default.removeItem(at: file)
        }
    }
}
