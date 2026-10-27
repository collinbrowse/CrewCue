import Foundation

public struct Route: Equatable, Hashable, Sendable {
    public var featureId: String
    public var state: FeatureState

    public init(featureId: String, state: FeatureState) {
        self.featureId = featureId
        self.state = state
    }

    public static func parse(_ urlString: String) -> Route? {
        guard urlString.hasPrefix("crewcue://") else { return nil }
        let rest = urlString.dropFirst("crewcue://".count)
        let pieces = rest.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let rawPath = String(pieces[0]).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let featureId = featureId(path: rawPath) else { return nil }
        var state = FeatureState.success
        if pieces.count > 1 {
            for pair in pieces[1].split(separator: "&") {
                let bits = pair.split(separator: "=", maxSplits: 1)
                if bits.first == "state", bits.count == 2, let parsed = FeatureState(rawValue: String(bits[1])) {
                    state = parsed
                }
            }
        }
        return Route(featureId: featureId, state: state)
    }

    static func featureId(path: String) -> String? {
        switch path {
        case "dev/hello": "hello"
        case "dev/schedule-sheet": "schedule-sheet"
        case "dev/cold-start": "cold-start"
        case "dev/pace-estimate": "pace-estimate"
        case "dev/crew-sheet-export": "crew-sheet-export"
        case "dev/outbox": "outbox-status"
        case "dev/auth-signed-out": "auth-sign-in"
        case "dev/join-crew": "join-crew"
        case "dev/athlete-setup": "athlete-setup"
        case "dev/onboarding-notifications": "onboarding-notifications"
        case "dev/check-in": "check-in"
        case "dev/course-settings": "course-settings"
        case "dev/pace-stop-edit": "pace-stop-edit"
        case "dev/readouts-incidents": "readouts-incidents"
        case "dev/gpx-import-progress": "gpx-import"
        case "dev/map": "map-track"
        case "dev/map-checkpoint-pick": "map-checkpoint-pick"
        case "dev/map-navigate": "map-navigate"
        case "dev/location-heartbeat": "location-heartbeat"
        case "dev/chat": "chat-thread"
        case "dev/chat-notification-prefs": "chat-notification-prefs"
        case "dev/push-registration": "push-registration"
        case "dev/profile": "profile"
        case "dev/room-members": "room-members"
        case "dev/strava": "strava"
        case "dev/app-shell": "app-shell"
        case "dev/loader": "brand-loader"
        default: nil
        }
    }
}
