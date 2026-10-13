import SwiftUI

struct ChatNotificationPrefsView: View {
    var model: ChatNotificationPrefsModel
    var roomId: String?
    var onChat: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Chat alerts")
                .font(.title2)
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
                    .font(.body)
            }
            Button("Chat", action: onChat)
                .buttonStyle(.bordered)
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
        Button(title, action: action)
            .buttonStyle(.borderedProminent)
            .tint(selected ? Color.accentColor : Color.secondary)
            .disabled(isWorking)
    }
}
