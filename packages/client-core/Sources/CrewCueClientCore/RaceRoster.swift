import Foundation

/// One race room the signed-in user belongs to, as the course switcher shows it.
public struct RaceSummary: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    /// The user's role in this room. Roles differ per room.
    public var role: String
    public var raceStartAt: String?
    /// The name this user's crew sees in this room. Names live on the membership, so they differ per room.
    public var displayName: String?

    public init(id: String, name: String, role: String, raceStartAt: String? = nil, displayName: String? = nil) {
        self.id = id
        self.name = name
        self.role = role
        self.raceStartAt = raceStartAt
        self.displayName = displayName
    }

    public init(room: RaceRoom, userId: String) {
        let membership = room.memberships.first { $0.userId == userId }
        let trimmed = room.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = membership?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.init(
            id: room.id,
            name: trimmed.isEmpty ? "Untitled race" : trimmed,
            role: membership?.role ?? (room.athleteId == userId ? "athlete" : "crew_member"),
            raceStartAt: room.raceStartAt,
            displayName: name.isEmpty ? nil : name
        )
    }
}

extension RaceSummary {
    /// The role as people read it, e.g. "Runner" or "Crew member".
    public var roleLabel: String { RaceRole.label(role) }
}

/// User-facing names for membership roles. Wire values such as `crew_member` never reach the screen.
public enum RaceRole {
    public static func label(_ role: String) -> String {
        switch role.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "athlete": "Runner"
        case "crew_member": "Crew member"
        case "crew_chief": "Crew chief"
        case "team_manager": "Team manager"
        default:
            sentenceCase(role.replacingOccurrences(of: "_", with: " "))
        }
    }

    private static func sentenceCase(_ text: String) -> String {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}

/// The user's loaded races and which one every tab follows.
public struct RaceRoster: Equatable, Sendable {
    public private(set) var races: [RaceSummary]
    public private(set) var activeRoomId: String?

    public init(races: [RaceSummary] = [], activeRoomId: String? = nil) {
        self.races = races
        self.activeRoomId = Self.trimmed(activeRoomId)
    }

    public var active: RaceSummary? {
        races.first { $0.id == activeRoomId }
    }

    /// Replace the list with the server's. Keep the preferred room while the server still lists
    /// it; a room the user left or was removed from falls back to the first listed race.
    public static func reconciled(races: [RaceSummary], preferred: String?) -> RaceRoster {
        var seen = Set<String>()
        let unique = races.filter { seen.insert($0.id).inserted }
        if let preferred = trimmed(preferred), unique.contains(where: { $0.id == preferred }) {
            return RaceRoster(races: unique, activeRoomId: preferred)
        }
        return RaceRoster(races: unique, activeRoomId: unique.first?.id)
    }

    /// Make a listed race active. Unknown ids leave the roster unchanged.
    @discardableResult
    public mutating func select(_ roomId: String) -> RaceSummary? {
        guard let race = races.first(where: { $0.id == roomId }) else { return nil }
        activeRoomId = race.id
        return race
    }

    /// Add or replace a race (create or join) and make it active.
    public mutating func adopt(_ race: RaceSummary) {
        if let index = races.firstIndex(where: { $0.id == race.id }) {
            races[index] = race
        } else {
            races.append(race)
        }
        activeRoomId = race.id
    }

    private static func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}

/// Per-room files (schedule cache, estimate, course settings draft, course map) live under
/// the user's directory so switching races never reads another room's draft.
public enum RoomStorage {
    public static func directory(userDirectory: URL, roomId: String) -> URL {
        let safe = roomId
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .replacingOccurrences(of: "..", with: "_")
        return userDirectory
            .appendingPathComponent("rooms", isDirectory: true)
            .appendingPathComponent(safe.isEmpty ? "_" : safe, isDirectory: true)
    }
}

public struct RaceListEnvelope: Codable, Sendable {
    public var rooms: [RaceRoom]
}

extension SessionController {
    /// Point the session at another race. Role and display name follow the room.
    public func select(_ race: RaceSummary) {
        update { session in
            session.roomId = race.id
            session.role = race.role
            session.displayName = race.displayName
        }
    }
}
