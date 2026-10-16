import SwiftUI

struct AuthSignInView: View {
    var model: AuthSignInModel
    var onJoin: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 12)
            Image("OnboardingRunner")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 348, maxHeight: 220)
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Trail runner illustration")
            VStack(alignment: .leading, spacing: 10) {
                Text("Welcome to CrewCue")
                    .font(CrewFont.display)
                    .foregroundStyle(theme.ink)
                Text("Find your crew and run race day together.")
                    .font(CrewFont.button)
                    .foregroundStyle(theme.body)
            }
            .padding(.top, 8)
            .padding(.bottom, 18)
            if model.statusMessage != "No session." {
                AuthSignInStatus(message: model.statusMessage)
            }
            VStack(spacing: 12) {
                Text(model.signingUp ? "Create an account" : "Sign in")
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                AuthSocialButton(title: "Continue with Apple", systemImage: "apple.logo", isWorking: model.isWorking, isBusy: model.workingConnection == "apple") {
                    model.signIn(connection: "apple")
                }
                AuthSocialButton(title: "Continue with Google", systemImage: "globe", isWorking: model.isWorking, isBusy: model.workingConnection == "google-oauth2") {
                    model.signIn(connection: "google-oauth2")
                }
                AuthSocialButton(title: "Continue with email", systemImage: "envelope", isWorking: model.isWorking, isBusy: model.workingConnection == "Username-Password-Authentication") {
                    model.signIn(connection: "Username-Password-Authentication")
                }
                AuthSignInButton(isWorking: model.isWorking, isBusy: model.workingConnection == "", action: { model.signIn() })
                Button(model.signingUp ? "Already have an account? Sign in" : "Need an account? Sign up") {
                    model.signingUp.toggle()
                }
                .font(CrewFont.body)
                .foregroundStyle(theme.primary)
                .disabled(model.isWorking)
                HStack(spacing: 12) {
                    Rectangle()
                        .fill(theme.divider)
                        .frame(height: 1)
                    Text("or")
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                    Rectangle()
                        .fill(theme.divider)
                        .frame(height: 1)
                }
                Button("Join your crew with a code", action: onJoin)
                    .buttonStyle(.crewGhost)
            }
            Spacer(minLength: 12)
        }
        .padding(.horizontal, CrewSpace.margin)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(CrewBackground())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.auth-signed-out")
        .accessibilityLabel("Signed out")
    }
}

struct AuthSignInStatus: View {
    let message: String
    @Environment(\.crew) private var theme

    var body: some View {
        Text(message)
            .font(CrewFont.body)
            .foregroundStyle(theme.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 12)
    }
}

struct AuthSignInButton: View {
    let isWorking: Bool
    var isBusy = false
    let action: () -> Void

    var body: some View {
        Button("Sign in", action: action)
            .buttonStyle(.crewPrimary)
            .disabled(isWorking)
            .crewBusy(isBusy)
    }
}

/// Light-grey pill with a leading icon, the DESIGN.md social auth treatment.
struct AuthSocialButton: View {
    let title: String
    let systemImage: String
    let isWorking: Bool
    var isBusy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
        }
        .buttonStyle(.crewSecondary)
        .disabled(isWorking)
        .crewBusy(isBusy)
    }
}
