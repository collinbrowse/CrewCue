import SwiftUI

struct ChatNotificationPrefsView: View {
    var model: ChatNotificationPrefsModel
    var roomId: String?
    var onChat: () -> Void
    @Environment(\.kinetic) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductTitle(title: "Chat alerts", subtitle: "Choose what reaches you from this room.")
                VStack(alignment: .leading, spacing: 12) {
                    ChatAlertChoice(title: "All", selected: model.preference == "all", isWorking: model.isWorking) {
                        Task { await model.choose("all") }
                    }
                    ChatAlertChoice(title: "Mentions", selected: model.preference == "mentions", isWorking: model.isWorking) {
                        Task { await model.choose("mentions") }
                    }
                    ChatAlertChoice(title: "None", selected: model.preference == "none", isWorking: model.isWorking) {
                        Task { await model.choose("none") }
                    }
                    if model.message.isEmpty == false {
                        Text(verbatim: model.message)
                            .font(.system(size: 16))
                            .foregroundStyle(theme.body)
                    }
                }
                .kineticCard()
                Button("Chat", action: onChat)
                    .buttonStyle(KineticSecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.chat-notification-prefs", label: "Chat alerts")
        .task(id: roomId ?? "") {
            await model.activate(roomId: roomId)
        }
    }
}

struct ChatAlertChoice: View {
    let title: String
    let selected: Bool
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Group {
            if selected {
                Button(title, action: action)
                    .buttonStyle(KineticProductButtonStyle())
            } else {
                Button(title, action: action)
                    .buttonStyle(KineticSecondaryButtonStyle())
            }
        }
        .disabled(isWorking)
    }
}
