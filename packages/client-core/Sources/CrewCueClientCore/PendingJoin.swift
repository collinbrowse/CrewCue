import Foundation

/// One invite code waiting to be joined, with where it came from and when it was saved. It
/// expires after `lifetime`.
public struct PendingJoin: Equatable, Sendable {
    public static let lifetime: TimeInterval = 7 * 24 * 60 * 60
    static let version = 1

    public var code: String
    public var source: InviteSource
    /// Whole milliseconds, so a saved record reads back equal.
    public var savedAt: Date

    public init(code: String, source: InviteSource, savedAt: Date) {
        self.code = code
        self.source = source
        self.savedAt = Self.wholeMilliseconds(savedAt)
    }

    public var expiresAt: Date { savedAt.addingTimeInterval(Self.lifetime) }

    /// Seven days old or more. A save stamped more than seven days ahead of `now` (the device
    /// clock moved back) counts as expired too, so a code never outlives its week by much.
    public func isExpired(at now: Date) -> Bool {
        abs(now.timeIntervalSince(savedAt)) >= Self.lifetime
    }

    var jsonObject: [String: Any] {
        [
            "version": Self.version,
            "code": code,
            "source": source.rawValue,
            "savedAtMs": Self.milliseconds(savedAt)
        ]
    }

    init?(jsonObject value: Any) {
        guard let object = value as? [String: Any],
              let code = object["code"] as? String, InviteLink.isCode(code),
              let source = (object["source"] as? String).flatMap(InviteSource.init(rawValue:)),
              let millis = (object["savedAtMs"] as? NSNumber)?.int64Value else { return nil }
        self.init(code: code, source: source, savedAt: Date(timeIntervalSince1970: Double(millis) / 1000))
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
    /// 404 (no race has this code) or 400 (the server refused the code's format).
    case invalidCode
    /// No network, or no answer before the deadline.
    case offline
    /// No session, or the server refused it (401).
    case signedOut
    /// Anything else: a 5xx, a rate limit, a body the app can't read.
    case failed
    /// Nothing saved, or the saved code expired.
    case nothingPending

    public static let raceFullMessage = "This race is full. Ask the runner to upgrade their pass."
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
        case 400, 404: return .invalidCode
        case 402 where http.reason == "room_unpaid" || http.decision == "room_unpaid": return .raceLocked
        case 409 where BillingErrors.isCrewLimit(http): return .raceFull
        default: return .failed
        }
    }
}

/// The one pending invite on this device, in the onboarding directory beside the storage root
/// (`OnboardingStore.pendingJoins`), so sign-out never wipes it. It belongs to no account: a code
/// saved signed out is joined by whoever signs in next on this device.
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

    /// Replaces any earlier pending code. Throws `PendingJoinError.invalidCode` unless `code`
    /// (whitespace trimmed) is six ASCII digits.
    @discardableResult
    public func save(code: String, source: InviteSource, now: Date) throws -> PendingJoin {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard InviteLink.isCode(code) else { throw PendingJoinError.invalidCode }
        let pending = PendingJoin(code: code, source: source, savedAt: now)
        try OnboardingFileLock.pendingJoin.run {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: pending.jsonObject, options: [.sortedKeys])
            try data.write(to: file, options: .atomic)
        }
        return pending
    }

    /// The pending code, nil when there is none. An expired or unreadable file is removed.
    public func read(now: Date) -> PendingJoin? {
        OnboardingFileLock.pendingJoin.run {
            guard FileManager.default.fileExists(atPath: file.path) else { return nil }
            guard let data = try? Data(contentsOf: file),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let pending = PendingJoin(jsonObject: object),
                  !pending.isExpired(at: now) else {
                try? FileManager.default.removeItem(at: file)
                return nil
            }
            return pending
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
    func clear(ifStill pending: PendingJoin) throws -> Bool {
        try OnboardingFileLock.pendingJoin.run {
            guard let data = try? Data(contentsOf: file),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  PendingJoin(jsonObject: object) == pending else { return false }
            try FileManager.default.removeItem(at: file)
            return true
        }
    }

    /// Joins the pending code as the graph's signed-in user (`POST /race-rooms/join-by-code`) and
    /// clears it on `clearsCode`. No pending code answers `nothingPending` and no session
    /// `signedOut`, both without a request.
    ///
    /// The server answers a new member and an existing one alike, so the user's races
    /// (`GET /race-rooms/mine`) are read first: a race already in that list is `alreadyMember`.
    /// That read failing for any reason but the network or the session only loses that
    /// distinction. Each request runs under its own `Deadline` (never cancelled: cancelling a
    /// URLSession task deadlocks Foundation on Android), so a read past its deadline never goes
    /// on to send the join. A join still in flight at its deadline is `offline` and keeps the
    /// code; the server keeps the join if it lands, and the next resolve answers `alreadyMember`.
    public func resolve(graph: ClientGraph, deadlineSeconds: Double = PendingJoinStore.deadlineSeconds) async -> PendingJoinOutcome {
        guard let pending = read(now: graph.clock.now()) else { return .nothingPending }
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
