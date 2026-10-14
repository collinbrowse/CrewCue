import Foundation
import CrewCueClientCore

@MainActor
struct CompositionRoot {
    func makeModel() -> ShellModel {
        let launch = LaunchConfiguration.resolve()
        let restored = launch.devSession ?? (launch.signedOut ? nil : Self.loadPersistedSession())
        let client = AppClient(
            graph: ClientGraph(
                transport: URLSessionTransport(),
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
