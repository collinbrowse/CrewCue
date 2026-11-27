import SwiftUI
import CrewCueClientCore

/// No race and no pending invite: two big choices.
struct OnboardingChooserView: View {
    var onRunner: () -> Void
    var onCrew: () -> Void
    /// Signed out only: an existing account goes straight to sign-in.
    var onSignIn: (() -> Void)?
    @Environment(\.crew) private var theme
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                Text(OnboardingCopy.chooserTitle)
                    .font(CrewFont.display)
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                choices
                if let onSignIn {
                    Button(OnboardingCopy.chooserSignIn, action: onSignIn)
                        .buttonStyle(.crewGhost)
                        .accessibilityIdentifier("crewcue.onboarding.chooser.sign-in")
                }
            }
            .padding(.horizontal, CrewSpace.margin)
            .padding(.vertical, CrewSpace.stackLg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .animation(.snappy, value: sizeClass)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(CrewBackground(glow: .onboarding))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding-chooser")
        .accessibilityLabel(OnboardingCopy.chooserTitle)
    }

    /// Side by side on a regular width, stacked on a compact one.
    @ViewBuilder
    private var choices: some View {
        let layout = sizeClass == .regular
            ? AnyLayout(HStackLayout(alignment: .top, spacing: CrewSpace.gutter))
            : AnyLayout(VStackLayout(alignment: .leading, spacing: CrewSpace.gutter))
        layout {
            OnboardingChoiceCard(
                title: OnboardingCopy.chooserRunner,
                detail: OnboardingCopy.chooserRunnerDetail,
                systemImage: "figure.run",
                identifier: "crewcue.onboarding.chooser.runner",
                action: onRunner
            )
            OnboardingChoiceCard(
                title: OnboardingCopy.chooserCrew,
                detail: OnboardingCopy.chooserCrewDetail,
                systemImage: "person.2",
                identifier: "crewcue.onboarding.chooser.crew",
                action: onCrew
            )
        }
    }
}

struct OnboardingChoiceCard: View {
    let title: String
    let detail: String
    let systemImage: String
    let identifier: String
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                Image(systemName: systemImage)
                    .font(.system(.largeTitle, weight: .semibold))
                    .foregroundStyle(theme.primary)
                    .accessibilityHidden(true)
                Text(title)
                    .font(CrewFont.headline)
                    .foregroundStyle(theme.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(CrewSpace.margin)
            .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
            .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous), interactive: true)
            .contentShape(RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityHint(detail)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(identifier)
    }
}

/// Signed in, before the race list answers for the first time: no chooser flash.
struct OnboardingLoadingView: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        CairnLoader(onLight: scheme == .light)
            .frame(width: 72, height: 72)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(CrewBackground(glow: .onboarding))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(OnboardingCopy.loading)
            .accessibilityIdentifier("crewcue.onboarding-loading")
    }
}
