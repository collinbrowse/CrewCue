import UIKit
import UserNotifications
import CrewCueClientCore

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

/// Hands tapped notifications to the shell. Holds one tap until the shell is ready; the shell's
/// `PushTapInbox` then holds it through sign-in and the race list.
@MainActor
final class PushRouter {
    static let shared = PushRouter()

    var handler: ((PushTapRoute) -> Void)? {
        didSet { deliverPending() }
    }
    private var pending: PushTapRoute?

    func open(_ route: PushTapRoute) {
        pending = route
        deliverPending()
    }

    private func deliverPending() {
        guard let handler, let route = pending else { return }
        pending = nil
        handler(route)
    }
}

final class CrewCueAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// Payload from the API: `{"aps": {...}, "type": "chat" | "tracking" | "unlock", "roomId": "..."}`
    /// (`chatPushTransports.ts`). Cold launch, background and foreground taps all arrive here.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let route = PushTapRoute.parse(userInfo: response.notification.request.content.userInfo)
        completionHandler()
        guard let route else { return }
        Task { @MainActor in
            PushRouter.shared.open(route)
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

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
