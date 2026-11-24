import Foundation

/// One invite code waiting to be joined, with where it came from, when it was saved and, once
/// known, whose it is. It expires after `lifetime`.
public struct PendingJoin: Equatable, Sendable {
    public static let lifetime: TimeInterval = 7 * 24 * 60 * 60
    static let version = 1

    public var code: String
    public var source: InviteSource
    /// Whole milliseconds, so a saved record reads back equal.
    public var savedAt: Date
    /// The signed-in user the code belongs to: who saved it, or who first read it signed in when
    /// it was saved signed out. Nil until then. Another user never sees it.
    public var savedBy: String?

    public init(code: String, source: InviteSource, savedAt: Date, savedBy: String? = nil) {
        self.code = code
        self.source = source
        self.savedAt = Self.wholeMilliseconds(savedAt)
        self.savedBy = Self.owner(savedBy)
    }

    public var expiresAt: Date { savedAt.addingTimeInterval(Self.lifetime) }

    /// Seven days old or more. A save stamped more than seven days ahead of `now` (the device
    /// clock moved back) counts as expired too, so a code never outlives its week by much.
    public func isExpired(at now: Date) -> Bool {
        abs(now.timeIntervalSince(savedAt)) >= Self.lifetime
    }

    /// The trimmed user id, nil for nil or blank (signed out).
    static func owner(_ userId: String?) -> String? {
        let trimmed = userId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    var jsonObject: [String: Any] {
        var object: [String: Any] = [
            "version": Self.version,
            "code": code,
            "source": source.rawValue,
            "savedAtMs": Self.milliseconds(savedAt)
        ]
        if let savedBy { object["savedBy"] = savedBy }
        return object
    }

    /// A `savedBy` that is there but isn't a user id makes the whole record unreadable: read as
    /// nobody's, the code would go to whoever signs in.
    init?(jsonObject value: Any) {
        guard let object = value as? [String: Any],
              let code = object["code"] as? String, InviteLink.isCode(code),
              let source = (object["source"] as? String).flatMap(InviteSource.init(rawValue:)),
              let millis = (object["savedAtMs"] as? NSNumber)?.int64Value else { return nil }
        var savedBy: String?
        if let raw = object["savedBy"] {
            guard let owner = Self.owner(raw as? String) else { return nil }
            savedBy = owner
        }
        self.init(code: code, source: source, savedAt: Date(timeIntervalSince1970: Double(millis) / 1000), savedBy: savedBy)
    }

    /// Nearest, not floor: a time already in whole milliseconds may come back a hair under.
    private static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    private static func wholeMilliseconds(_ date: Date) -> Date {
        Date(timeIntervalSince1970: Double(milliseconds(date)) / 1000)
    }
}

public enum PendingJoinError: Error, Equatable, Sendable {
    case invalidCode

    public var message: String {
        switch self {
        case .invalidCode: "Enter the 6-digit invite code."
        }
    }
}

/// What joining the pending code came to. `joined`, `alreadyMember` and `invalidCode` forget the
/// code; every other outcome keeps it for a retry (`clearsCode`).
public enum PendingJoinOutcome: Equatable, Sendable {
    case joined(roomId: String)
    /// The user was in this race already (its runner, or crew who joined before).
    case alreadyMember(roomId: String)
    /// 409 `crew_limit_reached`: the race's crew tier is full.
    case raceFull
    /// 402 `room_unpaid`: the runner hasn't paid for the race.
    case raceLocked
    /// 404 `Race room not found` (no race has this code) or 400 `Invalid room join payload` (the
    /// server refused the code's format). Any other 404 or 400 is `failed`.
    case invalidCode
    /// No network, or no answer before the deadline.
    case offline
    /// No signed-in user or session, or the server refused the session (401).
    case signedOut
    /// Anything else: a 5xx, a rate limit, a body the app can't read.
    case failed
    /// Nothing saved, or the saved code expired.
    case nothingPending

    /// The same words a refused Join shows (`BillingErrors.crewLimitForCrew`), on both platforms.
    public static let raceFullMessage = BillingErrors.crewLimitForCrew.message
    public static let invalidCodeMessage = "That invite code was not found."
    public static let offlineMessage = "Offline. Joining a race needs the network."
    public static let signedOutMessage = "Sign in to join this race."
    public static let failedMessage = "Couldn't join this race. Try again."
    public static let alreadyMemberMessage = "You're already in this race."

    /// The runtime op's `outcome`.
    public var name: String {
        switch self {
        case .joined: "joined"
        case .alreadyMember: "alreadyMember"
        case .raceFull: "raceFull"
        case .raceLocked: "raceLocked"
        case .invalidCode: "invalidCode"
        case .offline: "offline"
        case .signedOut: "signedOut"
        case .failed: "failed"
        case .nothingPending: "nothingPending"
        }
    }

    public var roomId: String? {
        switch self {
        case .joined(let roomId), .alreadyMember(let roomId): roomId
        default: nil
        }
    }

    /// What to show. Nil for a fresh join and for nothing pending.
    public var message: String? {
        switch self {
        case .joined, .nothingPending: nil
        case .alreadyMember: Self.alreadyMemberMessage
        case .raceFull: Self.raceFullMessage
        case .raceLocked: OnboardingState.raceLockedReason
        case .invalidCode: Self.invalidCodeMessage
        case .offline: Self.offlineMessage
        case .signedOut: Self.signedOutMessage
        case .failed: Self.failedMessage
        }
    }

    /// Joined, or a code no retry can fix. A full or locked race keeps the code: the runner can
    /// upgrade or pay, and the app clears it when the person gives up.
    public var clearsCode: Bool {
        switch self {
        case .joined, .alreadyMember, .invalidCode: true
        default: false
        }
    }

    /// Maps a failed `GET /race-rooms/mine` or `POST /race-rooms/join-by-code`. Pure.
    public static func outcome(for error: any Error) -> PendingJoinOutcome {
        if TransportFailure.isOffline(error) { return .offline }
        guard let http = error as? ClientHTTPError else { return .failed }
        switch http.status {
        // Status 0: no HTTP answer at all (a non-HTTP response or no base URL), as other ops read it.
        case 0: return .offline
        case 401: return .signedOut
        // Only the route's own answers: a 404 from a proxy, an edge, or an API build without the
        // route says nothing about the code, so it stays.
        case 404 where http.bodyError == "Race room not found": return .invalidCode
        case 400 where http.bodyError == "Invalid room join payload": return .invalidCode
        case 402 where http.reason == "room_unpaid" || http.decision == "room_unpaid": return .raceLocked
        case 409 where BillingErrors.isCrewLimit(http): return .raceFull
        default: return .failed
        }
    }
}

/// The one pending invite on this device, in the onboarding directory beside the storage root
/// (`OnboardingStore.pendingJoins`), so sign-out never wipes it.
///
/// Whose it is (`PendingJoin.savedBy`): a code saved signed in is that user's. A code saved signed
/// out is nobody's until the first signed-in read, which makes it that user's, so it goes to
/// whoever signs in next on this device. A user's code is hidden while signed out (and kept for
/// their next sign-in), and a different signed-in user's read removes it: one account's invite
/// never reaches another.
public struct PendingJoinStore: Sendable {
    /// `@` never appears in a percent-encoded user id, so no account's progress file has this name.
    public static let fileName = "@pending-join.json"
    /// Each of resolve's two requests gives up after this, keeping the code.
    public static let deadlineSeconds: Double = 20

    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public var file: URL { directory.appendingPathComponent(Self.fileName) }

    /// Replaces any earlier pending code, as `userId`'s (nil or blank: saved signed out, nobody's
    /// yet). Throws `PendingJoinError.invalidCode` unless `code` (whitespace trimmed) is six ASCII
    /// digits.
    @discardableResult
    public func save(code: String, source: InviteSource, userId: String?, now: Date) throws -> PendingJoin {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard InviteLink.isCode(code) else { throw PendingJoinError.invalidCode }
        let pending = PendingJoin(code: code, source: source, savedAt: now, savedBy: userId)
        try OnboardingFileLock.pendingJoin.run { try write(pending) }
        return pending
    }

    /// The pending code for `userId` (nil or blank: signed out), nil when there is none for them.
    ///
    /// - Saved signed out: anyone's. A signed-in read makes it this user's (`savedBy`), and answers
    ///   nil if that can't be saved, so the code never goes out unowned.
    /// - Saved by this user: theirs. Saved by another: nil, and removed when the reader is signed in
    ///   (kept while signed out, for its owner's next sign-in).
    ///
    /// A file read but expired or not a valid record is removed. A file that can't be read at all
    /// (on iOS, a protected file before the first unlock after a reboot) is kept and answers nil.
    public func read(userId: String?, now: Date) -> PendingJoin? {
        let reader = PendingJoin.owner(userId)
        return OnboardingFileLock.pendingJoin.run {
            guard FileManager.default.fileExists(atPath: file.path),
                  let data = try? Data(contentsOf: file) else { return nil }
            guard let object = try? JSONSerialization.jsonObject(with: data),
                  let pending = PendingJoin(jsonObject: object),
                  !pending.isExpired(at: now) else {
                try? FileManager.default.removeItem(at: file)
                return nil
            }
            switch (pending.savedBy, reader) {
            case (nil, nil):
                return pending
            case (nil, let reader?):
                var adopted = pending
                adopted.savedBy = reader
                do {
                    try write(adopted)
                    return adopted
                } catch {
                    return nil
                }
            case (_?, nil):
                return nil
            case (let owner?, let reader?):
                guard owner == reader else {
                    try? FileManager.default.removeItem(at: file)
                    return nil
                }
                return pending
            }
        }
    }

    public func clear() throws {
        try OnboardingFileLock.pendingJoin.run {
            if FileManager.default.fileExists(atPath: file.path) {
                try FileManager.default.removeItem(at: file)
            }
        }
    }

    /// Clears only when the saved record is still `pending`: a code saved while a join was in
    /// flight is not the one that join answered for.
    @discardableResult
    public func clear(ifStill pending: PendingJoin) throws -> Bool {
        try OnboardingFileLock.pendingJoin.run {
            guard let data = try? Data(contentsOf: file),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  PendingJoin(jsonObject: object) == pending else { return false }
            try FileManager.default.removeItem(at: file)
            return true
        }
    }

    /// Callers hold `OnboardingFileLock.pendingJoin`.
    private func write(_ pending: PendingJoin) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: pending.jsonObject, options: [.sortedKeys])
        try data.write(to: file, options: .atomic)
    }

    /// Joins `userId`'s pending code (`read(userId:now:)`) as the graph's signed-in session
    /// (`POST /race-rooms/join-by-code`) and clears it on `clearsCode`. No pending code for this
    /// user answers `nothingPending`, and no user id or no session `signedOut`, all without a
    /// request. Pass the user the graph's token belongs to.
    ///
    /// The server answers a new member and an existing one alike, so the user's races
    /// (`GET /race-rooms/mine`) are read first: a race already in that list is `alreadyMember`.
    /// That read failing for any reason but the network or the session only loses that
    /// distinction. Each request runs under its own `Deadline` (never cancelled: cancelling a
    /// URLSession task deadlocks Foundation on Android), so a read past its deadline never goes
    /// on to send the join. A join still in flight at its deadline is `offline` and keeps the
    /// code; the server keeps the join if it lands, and the next resolve answers `alreadyMember`.
    public func resolve(
        graph: ClientGraph,
        userId: String?,
        deadlineSeconds: Double = PendingJoinStore.deadlineSeconds
    ) async -> PendingJoinOutcome {
        let now = graph.clock.now()
        guard let user = PendingJoin.owner(userId) else {
            // Signed out: nothing joins. Only a code saved signed out is pending for this reader.
            return read(userId: nil, now: now) == nil ? .nothingPending : .signedOut
        }
        guard let pending = read(userId: user, now: now) else { return .nothingPending }
        let token = await graph.tokenProvider?.accessToken()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !token.isEmpty else { return .signedOut }
        let outcome: PendingJoinOutcome
        do {
            outcome = try await Self.join(graph: graph, code: pending.code, deadlineSeconds: deadlineSeconds)
        } catch {
            outcome = PendingJoinOutcome.outcome(for: error)
        }
        if outcome.clearsCode {
            do {
                try clear(ifStill: pending)
            } catch {
                graph.logger.log("pending join clear failed")
            }
        }
        return outcome
    }

    private static func join(graph: ClientGraph, code: String, deadlineSeconds: Double) async throws -> PendingJoinOutcome {
        let member: Set<String>?
        do {
            member = Set(try await Deadline.run(seconds: deadlineSeconds) {
                try await RaceDayAPI.myRaceRooms(graph: graph).map(\.id)
            })
        } catch {
            switch PendingJoinOutcome.outcome(for: error) {
            case .offline, .signedOut: throw error
            default: member = nil
            }
        }
        let roomId = try await Deadline.run(seconds: deadlineSeconds) {
            try await RaceDayAPI.join(graph: graph, code: code).room.id
        }.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !roomId.isEmpty else { return .failed }
        return member?.contains(roomId) == true ? .alreadyMember(roomId: roomId) : .joined(roomId: roomId)
    }
}
