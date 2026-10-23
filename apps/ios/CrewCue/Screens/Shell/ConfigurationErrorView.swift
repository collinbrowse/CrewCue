import SwiftUI

/// Shown instead of the app when a Release build was made without its server or sign-in settings.
struct ConfigurationErrorView: View {
    var problem: String
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CrewCue can't start")
                .font(CrewFont.display)
                .foregroundStyle(theme.ink)
            Text(verbatim: "\(problem) Install the latest version of the app.")
                .font(CrewFont.bodyLarge)
                .foregroundStyle(theme.body)
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.top, 64)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.background.ignoresSafeArea())
        .accessibilityIdentifier("crewcue.configuration-error")
    }
}
