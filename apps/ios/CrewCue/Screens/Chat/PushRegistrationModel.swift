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

    private let client: AppClient
    private var role = ""
    private var generation = 0

    init(client: AppClient) {
        self.client = client
    }

    func activate(role: String?) async {
        self.role = role ?? ""
        await register()
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
            message = "Push permission was denied."
            return
        }
        let token = await RemoteNotificationTokenCenter.shared.requestToken()
        guard ticket == generation else { return }
        guard let token, !token.isEmpty else {
            message = "No push token."
            return
        }
        await enqueue(token: token, ticket: ticket)
    }

    func clear() {
        generation += 1
        message = ""
        role = ""
        isWorking = false
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
            message = "No push token."
            return
        }
        let operation: StoredOperation
        do {
            operation = try await outbox.enqueuePush(
                deviceId: InstallDeviceId.current(),
                platform: "ios",
                token: token,
                role: role.isEmpty ? "crew" : role
            )
        } catch {
            guard ticket == generation else { return }
            message = "No push token."
            return
        }
        guard ticket == generation else { return }
        do {
            let report = try await RaceDayAPI.flushOutbox(graph: client.graph)
            guard ticket == generation else { return }
            if report.pending.contains(operation.id) {
                message = "Offline. Token queued."
            } else {
                message = "Push token queued for registration."
            }
        } catch {
            guard ticket == generation else { return }
            message = APIFailure.isOffline(error)
                ? "Offline. Token queued."
                : "Push token queued for registration."
        }
    }
}
