import SwiftUI

struct AuthSignInView: View {
    var model: AuthSignInModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AuthSignInTitle()
            AuthSignInMessage()
            AuthSignInStatus(message: model.statusMessage)
            AuthSignInButton(isWorking: model.isWorking, action: model.signIn)
        }
        .crewCueScreen(identifier: "crewcue.auth-signed-out", label: "Signed out")
    }
}

struct AuthSignInTitle: View {
    var body: some View {
        Text("Sign in")
            .font(.title2)
    }
}

struct AuthSignInMessage: View {
    var body: some View {
        Text("You are signed out.")
            .font(.body)
    }
}

struct AuthSignInStatus: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.body)
    }
}

struct AuthSignInButton: View {
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button("Sign in", action: action)
            .buttonStyle(.borderedProminent)
            .disabled(isWorking)
    }
}
