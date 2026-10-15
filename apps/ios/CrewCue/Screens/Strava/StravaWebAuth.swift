import AuthenticationServices
import UIKit

/// Opens Strava's authorize URL and returns `crewcue://strava` to the app.
@MainActor
final class StravaWebAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(authorizeURL: URL) async -> URL? {
        await withCheckedContinuation { continuation in
            let gate = StravaAuthResume(continuation)
            let session = ASWebAuthenticationSession(url: authorizeURL, callbackURLScheme: "crewcue") { callback, _ in
                gate.resume(callback)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if session.start() == false {
                gate.resume(nil)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.compactMap(\.keyWindow).first {
            return window
        }
        if let scene = scenes.first {
            return ASPresentationAnchor(windowScene: scene)
        }
        return ASPresentationAnchor()
    }
}

/// Resumes the auth continuation once, including when the session fails to start.
private final class StravaAuthResume: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL?, Never>?

    init(_ continuation: CheckedContinuation<URL?, Never>) {
        self.continuation = continuation
    }

    func resume(_ url: URL?) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(returning: url)
    }
}
