import Foundation

/// The steps a user finished that the server can't tell: the chooser pick, account-wide steps,
/// and per-race steps keyed by room id. Unknown names in a saved file are ignored.
public struct OnboardingProgress: Equatable, Sendable {
    public static let empty = OnboardingProgress()
    static let version = 1

    public var choice: OnboardingChoice?
    public var account: [OnboardingStep: OnboardingOutcome]
    public var races: [String: [OnboardingStep: OnboardingOutcome]]

    public init(
        choice: OnboardingChoice? = nil,
        account: [OnboardingStep: OnboardingOutcome] = [:],
        races: [String: [OnboardingStep: OnboardingOutcome]] = [:]
    ) {
        self.choice = choice
        self.account = account
        self.races = races
    }

    /// How a saved step ended. Steps that follow the server are never saved, so they read nil.
    public func outcome(_ step: OnboardingStep, roomId: String?) -> OnboardingOutcome? {
        if step.accountWide { return account[step] }
        guard let roomId = Self.room(roomId) else { return nil }
        return races[roomId]?[step]
    }

    /// Saves how a step ended. Server steps, an outcome the step does not offer, and a per-race
    /// step without a race are refused.
    public mutating func record(_ step: OnboardingStep, outcome: OnboardingOutcome, roomId: String?) throws {
        if step.followsServer { throw OnboardingError.followsServer(step) }
        guard step.allowedOutcomes.contains(outcome) else { throw OnboardingError.outcomeNotAllowed(step, outcome) }
        if step.accountWide {
            account[step] = outcome
            return
        }
        guard let roomId = Self.room(roomId) else { throw OnboardingError.roomRequired(step) }
        races[roomId, default: [:]][step] = outcome
    }

    /// Signed-out progress joins the account that signs in: the newer chooser pick wins and the
    /// account's own outcomes are kept. The pre-sign-in invite confirmation is not carried over,
    /// because a signed-in user accepts the invite directly.
    func adopting(_ guest: OnboardingProgress) -> OnboardingProgress {
        var merged = self
        merged.choice = guest.choice ?? choice
        for (step, outcome) in guest.account where step != .join && merged.account[step] == nil {
            merged.account[step] = outcome
        }
        for (roomId, steps) in guest.races {
            for (step, outcome) in steps where merged.races[roomId]?[step] == nil {
                merged.races[roomId, default: [:]][step] = outcome
            }
        }
        return merged
    }

    public var jsonObject: [String: Any] {
        var object: [String: Any] = [
            "version": Self.version,
            "account": Self.encode(account),
            "races": races.mapValues(Self.encode)
        ]
        if let choice { object["choice"] = choice.rawValue }
        return object
    }

    public init(jsonObject object: [String: Any]) {
        self.init(
            choice: (object["choice"] as? String).flatMap(OnboardingChoice.init(rawValue:)),
            account: Self.decode(object["account"]),
            races: ((object["races"] as? [String: Any]) ?? [:]).reduce(into: [:]) { races, entry in
                let steps = Self.decode(entry.value)
                if !steps.isEmpty { races[entry.key] = steps }
            }
        )
    }

    private static func encode(_ steps: [OnboardingStep: OnboardingOutcome]) -> [String: String] {
        Dictionary(uniqueKeysWithValues: steps.map { ($0.key.rawValue, $0.value.rawValue) })
    }

    private static func decode(_ value: Any?) -> [OnboardingStep: OnboardingOutcome] {
        ((value as? [String: Any]) ?? [:]).reduce(into: [:]) { steps, entry in
            guard let step = OnboardingStep(rawValue: entry.key), !step.followsServer,
                  let raw = entry.value as? String, let outcome = OnboardingOutcome(rawValue: raw) else { return }
            steps[step] = outcome
        }
    }

    private static func room(_ roomId: String?) -> String? {
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// One JSON file per user id, in an app-level directory that sign-out does not wipe. The
/// signed-out user (chooser pick, a confirmed invite) is a separate guest file that the next
/// sign-in adopts.
///
/// Both apps wipe their storage root on sign-out (`UserStorage.wipeAll`, Android
/// `SessionStore.clear`) and clear everything but `users/` on sign-in, so this directory sits
/// beside that root, never inside it (`directory(besideStorageRoot:)`).
public struct OnboardingStore: Sendable {
    public static let directoryName = "crewcue-onboarding"
    /// Percent-encoded user ids never contain `@` or `.`, so no account can be named this.
    static let guestFileName = "@signed-out.json"

    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// `<parent of root>/crewcue-onboarding`: iOS `Application Support/crewcue-onboarding`,
    /// Android `filesDir/crewcue-onboarding`.
    public static func directory(besideStorageRoot root: URL) -> URL {
        root.standardizedFileURL.deletingLastPathComponent()
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    /// Nil or blank is the signed-out guest.
    public func file(userId: String?) -> URL {
        let trimmed = userId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return directory.appendingPathComponent(Self.guestFileName) }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_")
        let name = trimmed.addingPercentEncoding(withAllowedCharacters: allowed) ?? "_"
        return directory.appendingPathComponent("\(name).json")
    }

    /// Missing or unreadable → empty progress.
    public func load(userId: String?) -> OnboardingProgress {
        guard let data = try? Data(contentsOf: file(userId: userId)),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return .empty
        }
        return OnboardingProgress(jsonObject: object)
    }

    public func save(_ progress: OnboardingProgress, userId: String?) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: progress.jsonObject, options: [.sortedKeys])
        try data.write(to: file(userId: userId), options: .atomic)
    }

    @discardableResult
    public func mark(_ step: OnboardingStep, outcome: OnboardingOutcome = .done, roomId: String? = nil, userId: String?) throws -> OnboardingProgress {
        try update(userId: userId) { try $0.record(step, outcome: outcome, roomId: roomId) }
    }

    @discardableResult
    public func choose(_ choice: OnboardingChoice, userId: String?) throws -> OnboardingProgress {
        try update(userId: userId) { $0.choice = choice }
    }

    /// Forgets the user's progress, or only one race's.
    public func reset(userId: String?, roomId: String? = nil) throws {
        if let roomId = roomId?.trimmingCharacters(in: .whitespacesAndNewlines), !roomId.isEmpty {
            _ = try update(userId: userId) { $0.races[roomId] = nil }
            return
        }
        try OnboardingFileLock.shared.run {
            let url = file(userId: userId)
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    /// Moves the guest's progress into `userId` and deletes the guest file. No guest file: the
    /// user's progress unchanged.
    @discardableResult
    public func adoptGuest(userId: String) throws -> OnboardingProgress {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return load(userId: nil) }
        return try OnboardingFileLock.shared.run {
            let guestURL = file(userId: nil)
            let own = load(userId: trimmed)
            guard FileManager.default.fileExists(atPath: guestURL.path) else { return own }
            let merged = own.adopting(load(userId: nil))
            if merged != own {
                try save(merged, userId: trimmed)
            }
            try FileManager.default.removeItem(at: guestURL)
            return merged
        }
    }

    private func update(userId: String?, _ change: (inout OnboardingProgress) throws -> Void) throws -> OnboardingProgress {
        try OnboardingFileLock.shared.run {
            var progress = load(userId: userId)
            try change(&progress)
            try save(progress, userId: userId)
            return progress
        }
    }
}

/// Serializes read-modify-write of the progress files in this process.
private final class OnboardingFileLock: @unchecked Sendable {
    static let shared = OnboardingFileLock()
    private let lock = NSLock()

    func run<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }
}
