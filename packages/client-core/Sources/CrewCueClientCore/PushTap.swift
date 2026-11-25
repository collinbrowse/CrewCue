import Foundation

/// A tapped push notification, read from the payload the API sends
/// (`services/api/src/lib/chatPushTransports.ts`): APNs puts `type` and `roomId` beside `aps`,
/// FCM puts them in `data`. `type` is the dispatch kind (`chatPushDispatch.ts`).
/// clients/behavior/push-tap.md.
public enum PushTapRoute: Equatable, Sendable {
    /// `chat`, or no `type` (payloads sent before kinds existed): the race's crew chat.
    case chat(roomId: String)
    /// `tracking`, the runner's start-tracking reminder (T-45, T-5): Map on that race, at Start
    /// tracking.
    case tracking(roomId: String)
    /// `unlock`, the unpaid-race reminder to the race's creator: that race's paywall.
    case unlock(roomId: String)

    /// Longest room id read from a payload. Room ids are UUIDs; anything longer isn't one.
    static let maxRoomIdLength = 128

    public var roomId: String {
        switch self {
        case .chat(let roomId), .tracking(let roomId), .unlock(let roomId): roomId
        }
    }

    /// The route for a payload's `type` and `roomId`. Nil (the tap opens the app where it was)
    /// for a kind this build doesn't route (`schedule`, anything newer), and for a missing,
    /// blank or oversized room id.
    public static func parse(type: String?, roomId: String?) -> PushTapRoute? {
        let room = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !room.isEmpty, room.count <= maxRoomIdLength,
              room.unicodeScalars.allSatisfy({ !CharacterSet.whitespacesAndNewlines.contains($0) }) else { return nil }
        switch type?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case nil, "", "chat": return .chat(roomId: room)
        case "tracking": return .tracking(roomId: room)
        case "unlock": return .unlock(roomId: room)
        default: return nil
        }
    }

    /// `parse(type:roomId:)` on a notification's `userInfo`. Values that aren't strings count
    /// as missing.
    public static func parse(userInfo: [AnyHashable: Any]) -> PushTapRoute? {
        let rawType = userInfo["type"]
        let type = rawType as? String
        if rawType != nil, type == nil { return nil }
        return parse(type: type, roomId: userInfo["roomId"] as? String)
    }
}

/// Where a tapped push lands once the race list says the race is the user's.
public enum PushTapDestination: Equatable, Sendable {
    /// The race's crew chat.
    case chat
    /// Map at Start tracking (the location-heartbeat panel).
    case startTracking
    /// Map on that race. A tracking reminder for a race the user doesn't run, or an unlock
    /// reminder for a race already paid or not theirs to pay for.
    case map
    /// The race's Race Pass paywall.
    case paywall
}

public enum PushTapResolution: Equatable, Sendable {
    /// Make `roomId` the active race and show `destination`.
    case open(roomId: String, destination: PushTapDestination)
    /// Signed out: keep the tap until someone signs in in this launch, then resolve it against
    /// that account's races.
    case holdUntilSignIn
    /// The race isn't in the loaded list yet: keep the tap, read the race list, resolve again.
    case awaitRaces
    /// Not one of this user's races (another account's push, a race left or deleted): forget it.
    case drop
}

extension PushTapRoute {
    /// Decides a tap against the signed-in user's races. `listedSinceTap` is true once the race
    /// list has answered after the tap: a race missing from that list is not the user's, so the
    /// tap is dropped rather than opening a race they can't read.
    public func resolve(
        signedIn: Bool,
        userId: String?,
        races: [RaceSummary],
        listedSinceTap: Bool
    ) -> PushTapResolution {
        guard signedIn else { return .holdUntilSignIn }
        guard let race = races.first(where: { $0.id == roomId }) else {
            return listedSinceTap ? .drop : .awaitRaces
        }
        let runsRace = race.role == "athlete" || race.isOwned(by: userId)
        switch self {
        case .chat:
            return .open(roomId: race.id, destination: .chat)
        case .tracking:
            return .open(roomId: race.id, destination: runsRace ? .startTracking : .map)
        case .unlock:
            // Paid since the push went out, or not this user's to pay for: the race itself.
            let payable = runsRace && race.paid != true
            return .open(roomId: race.id, destination: payable ? .paywall : .map)
        }
    }
}

/// The one tap waiting for the shell: held through sign-in or a race-list read, replaced by a
/// newer tap, and gone on sign-out. In memory only, so it never outlives the launch.
public struct PushTapInbox: Equatable, Sendable {
    public private(set) var pending: PushTapRoute?
    /// The race list answered after `pending` arrived.
    public private(set) var listedSinceTap = false

    public init() {}

    /// A new tap replaces any held one.
    public mutating func receive(_ route: PushTapRoute) {
        pending = route
        listedSinceTap = false
    }

    /// The race list answered. A held tap now resolves to open or drop.
    public mutating func noteRacesListed() {
        if pending != nil { listedSinceTap = true }
    }

    /// Resolves the held tap. `open` and `drop` clear it; `holdUntilSignIn` and `awaitRaces`
    /// keep it. Nil when nothing is held.
    public mutating func take(signedIn: Bool, userId: String?, races: [RaceSummary]) -> PushTapResolution? {
        guard let route = pending else { return nil }
        let resolution = route.resolve(signedIn: signedIn, userId: userId, races: races, listedSinceTap: listedSinceTap)
        switch resolution {
        case .open, .drop:
            clear()
        case .holdUntilSignIn:
            listedSinceTap = false
        case .awaitRaces:
            break
        }
        return resolution
    }

    /// Sign-out: a tap held for the signed-out account never opens for the next one.
    public mutating func clear() {
        pending = nil
        listedSinceTap = false
    }
}
