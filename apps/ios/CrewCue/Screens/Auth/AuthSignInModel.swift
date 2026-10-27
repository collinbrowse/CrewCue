import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class AuthSignInModel {
    private(set) var statusMessage = "No session."
    private(set) var isWorking = false
    /// The connection whose button started the current sign-in. Empty for the plain Sign in button.
    private(set) var workingConnection: String?
    var signingUp = false
    private let configuration: Auth0Configuration
    private var onSession: @MainActor (ClientSession) -> Void

    init(configuration: Auth0Configuration) {
        self.configuration = configuration
        self.onSession = { _ in }
    }

    func bindSession(_ action: @escaping @MainActor (ClientSession) -> Void) {
        onSession = action
    }

    func signIn(connection: String? = nil) {
        guard !isWorking else { return }
        isWorking = true
        workingConnection = connection ?? ""
        let provider = connection
        let signUp = signingUp
        Task {
            await performSignIn(connection: provider, signUp: signUp)
            isWorking = false
            workingConnection = nil
        }
    }

    private func performSignIn(connection: String?, signUp: Bool) async {
        guard configuration.hasKeys, Auth0SignIn.sdkAvailable else {
            statusMessage = "Sign-in isn't configured."
            return
        }
        do {
            let session = try await Auth0SignIn.authorize(configuration, connection: connection, signUp: signUp)
            statusMessage = "No session."
            onSession(session)
        } catch Auth0SignInFailure.cancelled {
            statusMessage = "No session."
        } catch Auth0SignInFailure.offline {
            statusMessage = "Offline. Can't reach Auth0."
        } catch {
            statusMessage = "Sign-in failed."
        }
    }
}
