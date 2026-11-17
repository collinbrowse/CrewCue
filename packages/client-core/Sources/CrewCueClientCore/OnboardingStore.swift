import Foundation

/// The steps a user finished that the server can't tell (the chooser pick, account-wide steps,
/// per-race steps keyed by room id, the invite confirmed while signed out), plus the race list
/// the server last answered. Unknown names in a saved file are ignored.
public struct OnboardingProgress: Equatable, Sendable {
    public static let empty = OnboardingProgress()
    static let version = 1

    public var choice: OnboardingChoice?
    public var account: [OnboardingStep: OnboardingOutcome]
    /// Tour steps, once per user per role: every race where they hold that role shares them.
    public var tours: [OnboardingChoice: [OnboardingStep: OnboardingOutcome]]
    public var races: [String: [OnboardingStep: OnboardingOutcome]]
    /// The last `GET /race-rooms/mine` list resolved on this device, in server order. Nil until one
    /// is: a relaunch before the list answers then has nothing to resolve from.
    public var knownRaces: [OnboardingRace]?
    /// Which invite the signed-out person confirmed, as a digest of its token or code (the file
    /// never keeps the token itself). A different invite is not confirmed.
    public var confirmedInvite: String?

    public init(
        choice: OnboardingChoice? = nil,
        account: [OnboardingStep: OnboardingOutcome] = [:],
        tours: [OnboardingChoice: [OnboardingStep: OnboardingOutcome]] = [:],
        races: [String: [OnboardingStep: OnboardingOutcome]] = [:],
        knownRaces: [OnboardingRace]? = nil,
        confirmedInvite: String? = nil
    ) {
        self.choice = choice
        self.account = account
        self.tours = tours
        self.races = races
        self.knownRaces = knownRaces
        self.confirmedInvite = confirmedInvite
    }

    /// True when nothing but the cached race list is saved: no chooser pick, account step, tour,
    /// per-race step or confirmed invite.
    var hasNoSavedSteps: Bool {
        choice == nil && account.isEmpty && tours.values.allSatisfy(\.isEmpty)
            && races.values.allSatisfy(\.isEmpty) && confirmedInvite == nil
    }

    /// How a tour step ended for a role.
    public func tourOutcome(_ step: OnboardingStep, role: OnboardingChoice) -> OnboardingOutcome? {
        tours[role]?[step]
    }

    /// An account that predates onboarding: nothing saved at all (not even a race list, so this
    /// is the first list ever answered) and a paid race in it. Both tours are done and the paid
    /// races skip setup (`Onboarding` already treats a paid race's setup as done). Unpaid races
    /// keep the normal flow. Nil list: no shortcut.
    func grandfathered(races list: [OnboardingRace]?) -> OnboardingProgress {
        guard let list, knownRaces == nil, hasNoSavedSteps, list.contains(where: \.isPaid) else { return self }
        var result = self
        for role in [OnboardingChoice.runner, .crew] {
            let steps = role == .runner ? OnboardingStep.runnerTour : OnboardingStep.crewTour
            result.tours[role] = Dictionary(uniqueKeysWithValues: steps.map { ($0, OnboardingOutcome.done) })
        }
        return result
    }

    /// How a saved step ended. Steps that follow the server are never saved, so they read nil.
    /// `join` reads done once any invite was confirmed; `inviteConfirmed(_:)` asks about one invite.
    /// A tour step reads from its role's tour (nil for `notifications`, shared: use `tourOutcome`).
    public func outcome(_ step: OnboardingStep, roomId: String?) -> OnboardingOutcome? {
        if step.isTour { return step.tourRole.flatMap { tourOutcome(step, role: $0) } }
        if step == .join { return confirmedInvite == nil ? nil : .done }
        if step.accountWide { return account[step] }
        guard let roomId = Self.room(roomId) else { return nil }
        return races[roomId]?[step]
    }

    /// True when this invite (its token or code) is the one confirmed.
    public func inviteConfirmed(_ invite: String?) -> Bool {
        guard let key = Self.inviteKey(invite) else { return false }
        return confirmedInvite == key
    }

    /// Saves how a step ended. Server steps, an outcome the step does not offer, a per-race step
    /// without a race, and `join` without its invite are refused. Confirming an invite replaces
    /// any earlier one.
    public mutating func record(
        _ step: OnboardingStep,
        outcome: OnboardingOutcome,
        roomId: String?,
        invite: String? = nil,
        role: OnboardingChoice? = nil
    ) throws {
        if step.followsServer { throw OnboardingError.followsServer(step) }
        guard step.allowedOutcomes.contains(outcome) else { throw OnboardingError.outcomeNotAllowed(step, outcome) }
        if step == .join {
            guard let key = Self.inviteKey(invite) else { throw OnboardingError.inviteRequired }
            confirmedInvite = key
            return
        }
        if step.accountWide {
            account[step] = outcome
            return
        }
        if step.isTour {
            // The role: as named, else the step's own, else the race's role from the saved list.
            let known = Self.room(roomId).flatMap { id in knownRaces?.first { $0.roomId == id } }
            guard let role = role ?? step.tourRole ?? known.map({ $0.isRunner ? .runner : .crew }) else {
                throw OnboardingError.roleRequired(step)
            }
            tours[role, default: [:]][step] = outcome
            return
        }
        guard let roomId = Self.room(roomId) else { throw OnboardingError.roomRequired(step) }
        races[roomId, default: [:]][step] = outcome
    }

    /// Signed-out progress joins the account that signs in: the newer chooser pick wins and the
    /// account's own outcomes are kept. The pre-sign-in invite confirmation is not carried over,
    /// because a signed-in user accepts the invite directly. A guest never has a race list.
    func adopting(_ guest: OnboardingProgress) -> OnboardingProgress {
        var merged = self
        merged.choice = guest.choice ?? choice
        for (step, outcome) in guest.account where step != .join && merged.account[step] == nil {
            merged.account[step] = outcome
        }
        for (role, steps) in guest.tours {
            for (step, outcome) in steps where merged.tours[role]?[step] == nil {
                merged.tours[role, default: [:]][step] = outcome
            }
        }
        for (roomId, steps) in guest.races {
            for (step, outcome) in steps where merged.races[roomId]?[step] == nil {
                merged.races[roomId, default: [:]][step] = outcome
            }
        }
        return merged
    }

    /// A stable digest of the invite's token or code (64-bit FNV-1a). Nil for blank.
    static func inviteKey(_ invite: String?) -> String? {
        let trimmed = invite?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return nil }
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in trimmed.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        let hex = String(hash, radix: 16)
        return "fnv1a64:" + String(repeating: "0", count: max(0, 16 - hex.count)) + hex
    }

    public var jsonObject: [String: Any] {
        var object: [String: Any] = [
            "version": Self.version,
            "account": Self.encode(account),
            "tours": Dictionary(uniqueKeysWithValues: tours.map { ($0.key.rawValue, Self.encode($0.value)) }),
            "races": races.mapValues(Self.encode)
        ]
        if let choice { object["choice"] = choice.rawValue }
        if let knownRaces { object["knownRaces"] = knownRaces.map(\.jsonObject) }
        if let confirmedInvite { object["confirmedInvite"] = confirmedInvite }
        return object
    }

    public init(jsonObject object: [String: Any]) {
        self.init(
            choice: (object["choice"] as? String).flatMap(OnboardingChoice.init(rawValue:)),
            account: Self.decode(object["account"]),
            tours: ((object["tours"] as? [String: Any]) ?? [:]).reduce(into: [:]) { tours, entry in
                guard let role = OnboardingChoice(rawValue: entry.key) else { return }
                let steps = Self.decode(entry.value).filter { $0.key.isTour }
                if !steps.isEmpty { tours[role] = steps }
            },
            races: ((object["races"] as? [String: Any]) ?? [:]).reduce(into: [:]) { races, entry in
                let steps = Self.decode(entry.value)
                if !steps.isEmpty { races[entry.key] = steps }
            },
            knownRaces: (object["knownRaces"] as? [Any]).map { $0.compactMap(OnboardingRace.init(jsonObject:)) },
            confirmedInvite: (object["confirmedInvite"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        )
    }

    private static func encode(_ steps: [OnboardingStep: OnboardingOutcome]) -> [String: String] {
        Dictionary(uniqueKeysWithValues: steps.map { ($0.key.rawValue, $0.value.rawValue) })
    }

    private static func decode(_ value: Any?) -> [OnboardingStep: OnboardingOutcome] {
        ((value as? [String: Any]) ?? [:]).reduce(into: [:]) { steps, entry in
            guard let step = OnboardingStep(rawValue: entry.key), !step.followsServer, step != .join,
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
/// sign-in adopts. A deleted account's file goes with it (`removeUser`).
///
/// Both apps wipe their storage root on sign-out (`UserStorage.wipeAll`, Android
/// `SessionStore.clear`) and clear everything but `users/` on sign-in, so this directory sits
/// beside that root, never inside it (`directory(besideStorageRoot:)`). The device's pending
/// invite is saved here too (`pendingJoins`).
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

    /// What both apps read on launch and on every race-list answer: the user's progress, with the
    /// guest's adopted on a signed-in read and a loaded list (`races` non-nil) saved as the last
    /// known one, so a relaunch without the list (offline, or before it answers) resolves from it.
    /// Signed out reads the guest file; races are the server's, so they are not saved for it.
    public func progress(signedIn: Bool, userId: String?, races: [OnboardingRace]?) throws -> OnboardingProgress {
        let trimmed = userId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard signedIn, !trimmed.isEmpty else { return load(userId: nil) }
        let adopted = try adoptGuest(userId: trimmed)
        guard let races else { return adopted }
        return try remember(races, userId: trimmed, grandfather: true)
    }

    /// Saves `races` as the user's last known list. Unchanged lists are not rewritten.
    @discardableResult
    public func remember(_ races: [OnboardingRace], userId: String, grandfather: Bool = false) throws -> OnboardingProgress {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return load(userId: nil) }
        return try OnboardingFileLock.shared.run {
            var progress = load(userId: trimmed)
            if grandfather { progress = progress.grandfathered(races: races) }
            guard progress.knownRaces != races else {
                if grandfather, progress != load(userId: trimmed) { try save(progress, userId: trimmed) }
                return progress
            }
            progress.knownRaces = races
            try save(progress, userId: trimmed)
            return progress
        }
    }

    /// `invite` is the pending invite's token or code, required for `join`.
    @discardableResult
    public func mark(
        _ step: OnboardingStep,
        outcome: OnboardingOutcome = .done,
        roomId: String? = nil,
        invite: String? = nil,
        role: OnboardingChoice? = nil,
        userId: String?
    ) throws -> OnboardingProgress {
        try update(userId: userId) { try $0.record(step, outcome: outcome, roomId: roomId, invite: invite, role: role) }
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

    /// Account deletion: removes the user's file. Never the signed-out guest's, so a blank id
    /// does nothing. Sign-out keeps the file.
    public func removeUser(_ userId: String) throws {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        try OnboardingFileLock.shared.run {
            let url = file(userId: trimmed)
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

/// What `readOnboarding` answers: the state, the progress it was decided from, and the pending
/// join it followed.
public struct OnboardingRead: Equatable, Sendable {
    public var state: OnboardingState
    public var progress: OnboardingProgress
    /// The saved pending join, nil when none is saved or it expired.
    public var pendingJoin: PendingJoin?

    public init(state: OnboardingState, progress: OnboardingProgress, pendingJoin: PendingJoin?) {
        self.state = state
        self.progress = progress
        self.pendingJoin = pendingJoin
    }
}

extension OnboardingStore {
    /// The device's pending invite, saved beside the progress files.
    public var pendingJoins: PendingJoinStore { PendingJoinStore(directory: directory) }

    /// `readOnboarding` for iOS: `progress(signedIn:userId:races:)`, then the state. A
    /// `pendingInvite` named here wins; otherwise the saved pending join's code is the pending
    /// invite, so a link opened signed out (or before onboarding asked) starts the crew join, and
    /// a signed-out confirmation of that code counts.
    public func read(
        signedIn: Bool,
        userId: String?,
        races: [OnboardingRace]? = nil,
        activeRoomId: String? = nil,
        pendingInvite: String? = nil,
        now: Date
    ) throws -> OnboardingRead {
        try read(signedIn: signedIn, userId: userId, races: races, activeRoomId: activeRoomId, now: now) { saved in
            pendingInvite ?? saved?.code
        }
    }

    /// `invite` picks the state's pending invite, given the saved pending join.
    func read(
        signedIn: Bool,
        userId: String?,
        races: [OnboardingRace]?,
        activeRoomId: String?,
        now: Date,
        invite: (PendingJoin?) -> String?
    ) throws -> OnboardingRead {
        let progress = try self.progress(signedIn: signedIn, userId: userId, races: races)
        let saved = pendingJoins.read(now: now)
        let state = Onboarding.resolve(OnboardingInput(
            signedIn: signedIn, userId: userId, pendingInvite: invite(saved),
            races: races, activeRoomId: activeRoomId, progress: progress
        ))
        return OnboardingRead(state: state, progress: progress, pendingJoin: saved)
    }
}

/// Serializes read-modify-write of the progress files in this process. Not reentrant: a body
/// never calls `run` on the same lock.
final class OnboardingFileLock: @unchecked Sendable {
    static let shared = OnboardingFileLock()
    /// The pending join file (`PendingJoinStore`).
    static let pendingJoin = OnboardingFileLock()
    private let lock = NSLock()

    func run<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }
}
