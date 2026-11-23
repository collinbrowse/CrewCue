import SwiftUI

/// Signed out: Auth0 sign-in or sign-up, or join a crew with a code. `onBack` is the way back to
/// the screen behind it (the chooser), as the navigation bar's Back; nil draws none.
struct AuthSignInView: View {
    var model: AuthSignInModel
    var onJoin: () -> Void
    var onBack: (() -> Void)? = nil
    @Environment(\.crew) private var theme

    var body: some View {
        // Laid out in the visible height, the illustration taking what is left, as before Back's
        // bar. When even its smallest size doesn't fit (a short display like iPhone Duo's outer
        // one, a large text size), the page scrolls instead of shrinking it further or cutting
        // off the title.
        GeometryReader { viewport in
            ScrollView {
                AtLeastHeight(height: viewport.size.height) {
                    content
                        .padding(.horizontal, CrewSpace.margin)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(CrewBackground())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.auth-signed-out")
        .accessibilityLabel("Signed out")
        // Auth0's sheet covers the screen while it works; cancelling it comes back here, Back included.
        .barBack(identifier: "crewcue.auth-sign-in.back", enabled: !model.isWorking, action: onBack)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 12)
            Image("OnboardingRunner")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 348, minHeight: 120, maxHeight: 220)
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
            // Text wraps at its full height and never truncates: only the illustration and the
            // spacing give way to a short height.
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 8)
            .padding(.bottom, 18)
            if model.statusMessage != "No session." {
                AuthSignInStatus(message: model.statusMessage)
                    .fixedSize(horizontal: false, vertical: true)
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
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 12)
        }
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

/// Offers its content `height` (a scroll view offers none) and is as tall as the content's answer
/// when that is taller: the content fills the height when it fits, and scrolls only when it can't.
private struct AtLeastHeight: Layout {
    var height: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        let size = content.sizeThatFits(ProposedViewSize(width: proposal.width, height: height))
        return CGSize(width: proposal.width ?? size.width, height: max(height, size.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: height))
    }
}
