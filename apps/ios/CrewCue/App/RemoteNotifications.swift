import UIKit

@MainActor
final class RemoteNotificationTokenCenter {
    static let shared = RemoteNotificationTokenCenter()

    private(set) var token: String?
    private var waiters: [Waiter] = []

    func deliver(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard !hex.isEmpty else {
            resumeWaiters(with: nil)
            return
        }
        token = hex
        resumeWaiters(with: hex)
    }

    func noteFailure() {
        guard token == nil else { return }
        resumeWaiters(with: nil)
    }

    func requestToken() async -> String? {
        if let token, !token.isEmpty {
            return token
        }
        return await withCheckedContinuation { continuation in
            let waiter = Waiter(continuation)
            waiters.append(waiter)
            UIApplication.shared.registerForRemoteNotifications()
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(3))
                waiter.resume(returning: self.token)
            }
        }
    }

    private func resumeWaiters(with value: String?) {
        let pending = waiters
        waiters.removeAll()
        for waiter in pending {
            waiter.resume(returning: value)
        }
    }

    @MainActor
    private final class Waiter {
        private var continuation: CheckedContinuation<String?, Never>?

        init(_ continuation: CheckedContinuation<String?, Never>) {
            self.continuation = continuation
        }

        func resume(returning value: String?) {
            let pending = continuation
            continuation = nil
            pending?.resume(returning: value)
        }
    }
}

final class CrewCueAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken
        Task { @MainActor in
            RemoteNotificationTokenCenter.shared.deliver(deviceToken: token)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            RemoteNotificationTokenCenter.shared.noteFailure()
        }
    }
}
