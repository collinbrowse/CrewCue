import Foundation
import CrewCueClientCore

@MainActor
struct CompositionRoot {
    func makeModel() -> ShellModel {
        let launch = LaunchConfiguration.resolve()
        let vault = KeychainSessionVault()
        let persisted = Self.restorePersistedSession(vault: vault)
        let restored = launch.devSession ?? (launch.signedOut ? nil : persisted)
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
        let purchaser = StorePurchasers.make(apiKey: launch.revenueCatAPIKey, client: client, fakeStore: launch.fakeStore)
        let model = ShellModel(
            client: client,
            route: launch.route,
            fixtureOverlay: launch.fixtureOverlay,
            authConfiguration: launch.auth,
            sessionVault: vault,
            purchaser: purchaser
        )
        expiry.model = model
        model.prepareStores()
        if let restored {
            model.adopt(restored)
            model.resumeRaceTrackingAtLaunch()
        }
        return model
    }

    /// Runs on every launch, even a signed-out or dev one, so a reinstall clears a leftover
    /// Keychain session and an older build's session file moves into the Keychain.
    private static func restorePersistedSession(vault: any SessionVault) -> ClientSession? {
        guard let root = try? AppDirectories.root() else { return nil }
        return SessionVaultLaunch.restore(vault: vault, directory: root, logger: OSLogLogger())
    }
}

/// Hands an authorized 401 from the transport to the shell, which decides whether it ends the session.
@MainActor
private final class SessionExpiryRelay {
    weak var model: ShellModel?
}
