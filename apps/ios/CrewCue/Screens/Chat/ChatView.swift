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
        VStack(alignment: .leading, spacing: 12) {
            Text("Chat")
                .font(.system(size: 28, weight: .bold))
                .padding(.horizontal, 20)
                .padding(.top, 12)
            ChatChannelLabel(channelId: model.channelId)
                .padding(.horizontal, 20)
            ScrollView {
                ChatTranscript(lines: model.lines)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
            }
            ChatStatusText(message: model.statusMessage)
                .padding(.horizontal, 20)
            ChatComposer(draft: $model.draft, names: model.mentionNames, isSending: model.isSending, onSend: model.send)
                .padding(.horizontal, 20)
            HStack(spacing: 8) {
                Button("Alert settings", action: onAlerts)
                    .buttonStyle(KineticSecondaryButtonStyle())
                Button("Push registration", action: onPush)
                    .buttonStyle(KineticSecondaryButtonStyle())
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityIdentifier("crewcue.chat")
        .accessibilityLabel("Chat")
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
    @Environment(\.kinetic) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(lines) { line in
                Text(verbatim: line.text)
                    .font(.system(size: 16))
                    .foregroundStyle(theme.ink)
                    .padding(12)
                    .background(theme.secondaryButton, in: RoundedRectangle(cornerRadius: 12))
            }
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
