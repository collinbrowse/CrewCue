import SwiftUI
import CrewCueClientCore

struct ChatTabPage: View {
    var model: ShellModel

    var body: some View {
        switch model.route.featureId {
        case "chat-notification-prefs":
            ChatNotificationPrefsView(
                model: model.chatPrefsModel,
                roomId: model.signedInRoomId,
                onChat: { model.show(Route(featureId: "chat-thread", state: .success)) }
            )
        case "push-registration":
            PushRegistrationView(
                model: model.pushModel,
                role: model.signedInRole,
                onChat: { model.show(Route(featureId: "chat-thread", state: .success)) }
            )
        default:
            ChatView(
                model: model.chatModel,
                userId: model.signedInUserId,
                roomId: model.signedInRoomId,
                role: model.signedInRole,
                displayName: model.signedInDisplayName,
                onAlerts: { model.show(Route(featureId: "chat-notification-prefs", state: .success)) },
                onPush: { model.show(Route(featureId: "push-registration", state: .success)) }
            )
        }
    }
}

struct ChatView: View {
    @Bindable var model: ChatModel
    var userId: String?
    var roomId: String?
    var role: String?
    var displayName: String?
    var onAlerts: () -> Void
    var onPush: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Chat")
                    .font(.title2)
                ChatChannelLabel(channelId: model.channelId)
                ChatTranscript(lines: model.lines)
                ChatStatusText(message: model.statusMessage)
                ChatComposer(draft: $model.draft, names: model.mentionNames, isSending: model.isSending, onSend: model.send)
                Button("Alert settings", action: onAlerts)
                    .buttonStyle(.bordered)
                Button("Push registration", action: onPush)
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.chat", label: "Chat")
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId, role: role, displayName: displayName)
        }
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")|\(role ?? "")|\(displayName ?? "")"
    }
}

struct ChatChannelLabel: View {
    let channelId: String

    var body: some View {
        if channelId.isEmpty == false {
            Text(verbatim: channelId)
                .font(.body)
                .accessibilityLabel("Channel")
        }
    }
}

struct ChatTranscript: View {
    let lines: [ChatLine]

    var body: some View {
        ForEach(lines) { line in
            Text(verbatim: line.text)
                .font(.body)
        }
    }
}

struct ChatStatusText: View {
    let message: String

    var body: some View {
        if message.isEmpty == false {
            Text(verbatim: message)
                .font(.body)
        }
    }
}

struct ChatComposer: View {
    @Binding var draft: String
    let names: [String]
    let isSending: Bool
    let onSend: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Message", text: $draft, axis: .vertical)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Message")
            if names.isEmpty == false {
                Text(verbatim: names.joined(separator: ", "))
                    .font(.body)
                    .accessibilityLabel("Mentions")
            }
            Button("Send") {
                Task { await onSend() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }
}
