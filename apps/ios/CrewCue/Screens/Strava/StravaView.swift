import SwiftUI

struct StravaView: View {
    @Bindable var model: StravaModel
    var onProfile: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductTitle(
                    title: "Strava",
                    subtitle: "Recent efforts improve the pace estimate."
                )
                VStack(alignment: .leading, spacing: 12) {
                    if model.message.isEmpty == false {
                        Text(verbatim: model.message)
                            .font(CrewFont.bodyLarge)
                            .foregroundStyle(theme.body)
                    }
                    Button("Connect") {
                        Task { await model.connect() }
                    }
                    .buttonStyle(.crewPrimary)
                    .disabled(model.busy)
                    Button("Disconnect") {
                        Task { await model.disconnect() }
                    }
                    .buttonStyle(.crewSecondary)
                    .disabled(model.busy)
                }
                .crewCard()
                Button("Profile", action: onProfile)
                    .buttonStyle(.crewSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.strava", label: "Strava")
        .task {
            await model.activate()
        }
    }
}
