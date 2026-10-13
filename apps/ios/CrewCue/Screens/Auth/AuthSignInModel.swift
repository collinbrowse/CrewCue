import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class AuthSignInModel {
    private(set) var statusMessage = "No session."
    private(set) var isWorking = false
    private let configuration: Auth0Configuration
    private var onSession: @MainActor (ClientSession) -> Void

    init(configuration: Auth0Configuration) {
        self.configuration = configuration
        self.onSession = { _ in }
    }

    func bindSession(_ action: @escaping @MainActor (ClientSession) -> Void) {
        onSession = action
    }

    func signIn() {
        guard !isWorking else { return }
        isWorking = true
        Task {
            await performSignIn()
            isWorking = false
        }
    }

    private func performSignIn() async {
        guard configuration.hasKeys, Auth0SignIn.sdkAvailable else {
            statusMessage = "Sign-in failed."
            return
        }
        do {
            let session = try await Auth0SignIn.authorize(configuration)
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
