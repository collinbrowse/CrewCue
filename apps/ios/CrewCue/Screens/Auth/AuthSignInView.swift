import SwiftUI

struct AuthSignInView: View {
    var model: AuthSignInModel
    var onJoin: () -> Void
    @Environment(\.kinetic) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 12)
            Image("OnboardingRunner")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 348, maxHeight: 196)
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Trail runner illustration")
            VStack(alignment: .leading, spacing: 10) {
                Text("Welcome to CrewCue")
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundStyle(theme.ink)
                Text("Find your crew and run race day together.")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(theme.body)
            }
            .padding(.top, 8)
            .padding(.bottom, 18)
            AuthSignInStatus(message: model.statusMessage)
            VStack(spacing: 12) {
                AuthSignInButton(isWorking: model.isWorking, action: model.signIn)
                HStack(spacing: 12) {
                    Rectangle()
                        .fill(Color(red: 0.847, green: 0.820, blue: 0.769))
                        .frame(height: 1)
                    Text("or")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(theme.body)
                    Rectangle()
                        .fill(Color(red: 0.847, green: 0.820, blue: 0.769))
                        .frame(height: 1)
                }
                Button("Join your crew with a code", action: onJoin)
                    .buttonStyle(KineticAuthOutlineButtonStyle())
            }
            Spacer(minLength: 12)
        }
        .padding(.horizontal, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.background)
        .accessibilityIdentifier("crewcue.auth-signed-out")
        .accessibilityLabel("Signed out")
    }
}

struct AuthSignInStatus: View {
    let message: String
    @Environment(\.kinetic) private var theme

    var body: some View {
        Text(message)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(theme.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 12)
    }
}

struct AuthSignInButton: View {
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button("Sign in", action: action)
            .buttonStyle(KineticAuthButtonStyle())
            .disabled(isWorking)
    }
}
