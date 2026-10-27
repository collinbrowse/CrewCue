import Foundation
import CrewCueClientCore

@MainActor
struct CompositionRoot {
    func makeModel() -> ShellModel {
        let launch = LaunchConfiguration.resolve()
        let restored = launch.devSession ?? (launch.signedOut ? nil : Self.loadPersistedSession())
        let expiry = SessionExpiryRelay()
        let transport = SessionExpiryTransport(wrapping: URLSessionTransport()) { rejectedToken in
            Task { @MainActor in
                expiry.model?.expireSession(rejectedToken: rejectedToken)
            }
        }
        let client = AppClient(
            graph: ClientGraph(
                transport: transport,
                clock: SystemClock(),
                logger: OSLogLogger(),
                baseURL: launch.baseURL,
                tokenProvider: StaticTokenProvider(token: restored?.accessToken),
                session: SessionController()
            )
        )
        let model = ShellModel(
            client: client,
            route: launch.route,
            fixtureOverlay: launch.fixtureOverlay,
            authConfiguration: launch.auth
        )
        expiry.model = model
        model.prepareStores()
        if let restored {
            model.adopt(restored)
        }
        return model
    }

    private static func loadPersistedSession() -> ClientSession? {
        guard let root = try? AppDirectories.root() else { return nil }
        return try? SessionFile.load(directory: root)
    }
}

/// Hands an authorized 401 from the transport to the shell, which decides whether it ends the session.
@MainActor
private final class SessionExpiryRelay {
    weak var model: ShellModel?
}
