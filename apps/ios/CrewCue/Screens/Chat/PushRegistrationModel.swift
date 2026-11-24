import Foundation
import Observation
import UIKit
import UserNotifications
import CrewCueClientCore

@MainActor
enum InstallDeviceId {
    private static let key = "crewcue.install-device-id"

    static func current() -> String {
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty {
            return existing
        }
        let created = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        UserDefaults.standard.set(created, forKey: key)
        return created
    }
}

@MainActor
@Observable
final class PushRegistrationModel {
    private(set) var message = ""
    private(set) var isWorking = false
    /// Notifications are allowed and this phone's token went to the server (or is queued for it).
    private(set) var enabled = false

    private let client: AppClient
    private var role = ""
    private var generation = 0

    init(client: AppClient) {
        self.client = client
    }

    /// Registering asks for notification permission, so only the push deeplink registers on appear.
    func activate(role: String?, registerNow: Bool) async {
        self.role = role ?? ""
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        enabled = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
        if registerNow {
            await register()
        }
    }

    func register() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        generation += 1
        let ticket = generation
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard ticket == generation else { return }
        let allowed = await authorization(status: settings.authorizationStatus)
        guard ticket == generation else { return }
        guard allowed else {
            enabled = false
            message = "Notifications are off for CrewCue. Turn them on in iOS Settings."
            return
        }
        let token = await RemoteNotificationTokenCenter.shared.requestToken()
        guard ticket == generation else { return }
        guard let token, !token.isEmpty else {
            message = "This phone couldn't set up alerts. Try again."
            return
        }
        await enqueue(token: token, ticket: ticket)
    }

    /// Re-registers this device's token without asking, when notifications are already allowed.
    func refreshIfAuthorized(role: String?) async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return }
        self.role = role ?? ""
        generation += 1
        let ticket = generation
        guard let token = await RemoteNotificationTokenCenter.shared.requestToken(), !token.isEmpty else { return }
        await enqueue(token: token, ticket: ticket)
        message = ""
    }

    static let offlineMessage = "Offline. Alerts start once this phone is back online."

    func clear() {
        generation += 1
        enabled = false
        message = ""
        role = ""
        isWorking = false
    }

    /// Debug builds get tokens from the APNs development gateway (see CrewCue.entitlements).
    static var apnsEnvironment: String {
        #if DEBUG
        "development"
        #else
        "production"
        #endif
    }

    private func authorization(status: UNAuthorizationStatus) async -> Bool {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            do {
                return try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            } catch {
                return false
            }
        @unknown default:
            return false
        }
    }

    private func enqueue(token: String, ticket: Int) async {
        guard let outbox = client.graph.outbox else {
            message = "This phone couldn't set up alerts. Try again."
            return
        }
        let operation: StoredOperation
        do {
            operation = try await outbox.enqueuePush(
                deviceId: InstallDeviceId.current(),
                platform: "ios",
                token: token,
                role: role.isEmpty ? "crew" : role,
                apnsEnvironment: Self.apnsEnvironment
            )
        } catch {
            guard ticket == generation else { return }
            message = "This phone couldn't set up alerts. Try again."
            return
        }
        guard ticket == generation else { return }
        do {
            let report = try await RaceDayAPI.flushOutbox(graph: client.graph)
            guard ticket == generation else { return }
            enabled = true
            message = report.pending.contains(operation.id) ? Self.offlineMessage : ""
        } catch {
            guard ticket == generation else { return }
            enabled = true
            message = APIFailure.isOffline(error) ? Self.offlineMessage : ""
        }
    }
}
