import SwiftUI

struct StravaView: View {
    @Bindable var model: StravaModel
    var onProfile: () -> Void
    @Environment(\.kinetic) private var theme

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
                            .font(.system(size: 16))
                            .foregroundStyle(theme.body)
                    }
                    Button("Connect") {
                        Task { await model.connect() }
                    }
                    .buttonStyle(KineticProductButtonStyle())
                    .disabled(model.busy)
                    Button("Disconnect") {
                        Task { await model.disconnect() }
                    }
                    .buttonStyle(KineticSecondaryButtonStyle())
                    .disabled(model.busy)
                }
                .kineticCard()
                Button("Profile", action: onProfile)
                    .buttonStyle(KineticSecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.strava", label: "Strava")
        .task {
            await model.activate()
        }
    }
}
