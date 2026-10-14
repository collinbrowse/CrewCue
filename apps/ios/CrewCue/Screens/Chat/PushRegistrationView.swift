import SwiftUI

struct PushRegistrationView: View {
    var model: PushRegistrationModel
    var role: String?
    var onChat: () -> Void
    @Environment(\.kinetic) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductTitle(title: "This device", subtitle: "Register so race alerts can reach you.")
                VStack(alignment: .leading, spacing: 12) {
                    if model.message.isEmpty == false {
                        Text(verbatim: model.message)
                            .font(.system(size: 16))
                            .foregroundStyle(theme.body)
                    }
                    Button("Register this device") {
                        Task { await model.register() }
                    }
                    .buttonStyle(KineticProductButtonStyle())
                    .disabled(model.isWorking)
                }
                .kineticCard()
                Button("Chat", action: onChat)
                    .buttonStyle(KineticSecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.push-registration", label: "Push")
        .task(id: role ?? "") {
            await model.activate(role: role)
        }
    }
}
