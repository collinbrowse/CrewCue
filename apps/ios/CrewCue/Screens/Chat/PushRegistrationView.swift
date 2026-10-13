import SwiftUI

struct PushRegistrationView: View {
    var model: PushRegistrationModel
    var role: String?
    var onChat: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Push")
                .font(.title2)
            if model.message.isEmpty == false {
                Text(verbatim: model.message)
                    .font(.body)
            }
            Button("Register this device") {
                Task { await model.register() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isWorking)
            Button("Chat", action: onChat)
                .buttonStyle(.bordered)
        }
        .crewCueScreen(identifier: "crewcue.push-registration", label: "Push")
        .task(id: role ?? "") {
            await model.activate(role: role)
        }
    }
}
