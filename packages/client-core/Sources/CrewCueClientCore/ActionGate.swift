import Foundation

public enum ActionPolicy: String, Sendable {
    case ignoreIfBusy
    case lock
    case replace
}

/// Cancellation handle for one in-flight action. `replace` and `abort` set `isCancelled`.
public struct ActionTicket: Sendable {
    fileprivate let flag: CancelFlag

    public var isCancelled: Bool { flag.isCancelled }

    fileprivate init(flag: CancelFlag) {
        self.flag = flag
    }
}

private final class CancelFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}

/// Single-flight actions. Native replacement for the TypeScript ActionRegistry.
public actor ActionGate {
    private struct Flight {
        var generation: UInt
        var flag: CancelFlag
    }

    private var flights: [String: Flight] = [:]
    private var nextGeneration: UInt = 0

    public init() {}

    /// Returns false when the call is skipped because the key is already running.
    public func run(key: String, policy: ActionPolicy, _ body: @Sendable () async throws -> Void) async throws -> Bool {
        try await run(key: key, policy: policy) { _ in
            try await body()
        }
    }

    /// Same single-flight rules. The ticket flips when a later `replace` or `abort` supersedes this call.
    @discardableResult
    public func run(
        key: String,
        policy: ActionPolicy,
        _ body: @Sendable (ActionTicket) async throws -> Void
    ) async throws -> Bool {
        if let existing = flights[key] {
            switch policy {
            case .ignoreIfBusy, .lock:
                return false
            case .replace:
                existing.flag.cancel()
            }
        }
        nextGeneration &+= 1
        let generation = nextGeneration
        let flag = CancelFlag()
        flights[key] = Flight(generation: generation, flag: flag)
        defer {
            if flights[key]?.generation == generation {
                flights[key] = nil
            }
        }
        try await body(ActionTicket(flag: flag))
        if flag.isCancelled {
            throw CancellationError()
        }
        return true
    }

    public func isBusy(_ key: String) -> Bool {
        flights[key] != nil
    }

    public func abort(_ key: String) {
        flights[key]?.flag.cancel()
        flights[key] = nil
    }
}

public enum ErrorCatalog {
    private static let messages = [
        "locationUnavailable": "We couldn't find your location. Turn on Location Services or try again.",
        "locationPermissionDenied": "Location access is off. Turn it on in Settings to center the map on you.",
        "saveFailed": "Couldn't save your changes. Check your connection and try again.",
        "finishSetupFailed": "Couldn't finish setup. Check your connection and try again.",
        "networkOffline": "You're offline. We'll retry when you're connected.",
        "unknown": "Something went wrong. Please try again.",
        "roomCreateFailed": "Couldn't create your race room. Please try again.",
        "fetchFailed": "Couldn't refresh data. Pull to refresh or try again in a moment.",
        "forbidden": "You don't have permission to do that.",
        "notFound": "That item is no longer available.",
        "invalidInput": "Some fields need a fix before we can continue."
    ]

    public static func message(_ key: String) -> String {
        messages[key] ?? messages["unknown"] ?? "Something went wrong. Please try again."
    }
}
