import SwiftUI

struct StravaView: View {
    @Bindable var model: StravaModel
    var onProfile: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Strava")
                    .font(.title2)
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(.body)
                }
                Button("Connect") {
                    Task { await model.connect() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.busy)
                Button("Disconnect") {
                    Task { await model.disconnect() }
                }
                .buttonStyle(.bordered)
                .disabled(model.busy)
                Button("Profile", action: onProfile)
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.strava", label: "Strava")
        .task {
            await model.activate()
        }
    }
}
