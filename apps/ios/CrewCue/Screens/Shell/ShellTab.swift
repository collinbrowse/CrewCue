import SwiftUI

enum ShellTab: String, CaseIterable, Identifiable, Hashable {
    case map
    case pace
    case chat
    case profile

    var id: String { rawValue }

    var featureId: String {
        switch self {
        case .map: "map-track"
        case .pace: "schedule-sheet"
        case .chat: "chat-thread"
        case .profile: "profile"
        }
    }

    var title: LocalizedStringKey {
        switch self {
        case .map: "Map"
        case .pace: "Pace"
        case .chat: "Chat"
        case .profile: "Profile"
        }
    }

    var systemImage: String {
        switch self {
        case .map: "map"
        case .pace: "stopwatch"
        case .chat: "bubble.left"
        case .profile: "person"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .map: "crewcue.tab.map"
        case .pace: "crewcue.tab.pace"
        case .chat: "crewcue.tab.chat"
        case .profile: "crewcue.tab.profile"
        }
    }

    static func matching(featureId: String) -> ShellTab? {
        if isPaceFeature(featureId) {
            return .pace
        }
        if isMapFeature(featureId) {
            return .map
        }
        if isChatFeature(featureId) {
            return .chat
        }
        if isProfileFeature(featureId) {
            return .profile
        }
        return allCases.first { $0.featureId == featureId }
    }

    static func isProfileFeature(_ featureId: String) -> Bool {
        switch featureId {
        case "profile", "room-members", "readouts-incidents":
            true
        default:
            false
        }
    }

    static func isChatFeature(_ featureId: String) -> Bool {
        switch featureId {
        case "chat-thread":
            true
        default:
            false
        }
    }

    /// Settings live in the settings sheet, which opens over whichever tab is showing.
    static func isSettingsFeature(_ featureId: String) -> Bool {
        switch featureId {
        case "chat-notification-prefs", "push-registration", "strava":
            true
        default:
            false
        }
    }

    static func isMapFeature(_ featureId: String) -> Bool {
        switch featureId {
        case "map-track", "map-checkpoint-pick", "map-navigate", "location-heartbeat":
            true
        default:
            false
        }
    }

    static func isPaceFeature(_ featureId: String) -> Bool {
        switch featureId {
        case "schedule-sheet", "cold-start", "pace-estimate", "crew-sheet-export", "outbox-status", "check-in", "course-settings", "gpx-import":
            true
        default:
            false
        }
    }
}
