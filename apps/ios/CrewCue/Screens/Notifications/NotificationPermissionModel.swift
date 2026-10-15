import Foundation
import Observation
import UserNotifications

enum NotificationPermissionState: Equatable {
    case off
    case granted
    case denied

    var message: String {
        switch self {
        case .off: "Notifications are off."
        case .granted: "Notifications are on."
        case .denied: "Notification permission was denied."
        }
    }
}

@MainActor
@Observable
final class NotificationPermissionModel {
    private(set) var state: NotificationPermissionState = .off
    private(set) var isWorking = false

    var statusMessage: String { state.message }

    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        state = Self.state(for: settings.authorizationStatus)
    }

    func request() {
        guard !isWorking else { return }
        isWorking = true
        Task {
            await performRequest()
            isWorking = false
        }
    }

    private func performRequest() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        } catch {
            state = .denied
            return
        }
        await refresh()
    }

    private static func state(for status: UNAuthorizationStatus) -> NotificationPermissionState {
        switch status {
        case .authorized, .provisional, .ephemeral:
            .granted
        case .denied:
            .denied
        case .notDetermined:
            .off
        @unknown default:
            .off
        }
    }
}
