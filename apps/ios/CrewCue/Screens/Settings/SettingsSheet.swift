import SwiftUI

/// Every app setting, reached from the top-bar gear on any tab. Settings deeplinks open this sheet at their section.
struct ShellSettingsSheet: View {
    var model: ShellModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crew) private var theme

    var body: some View {
        ToolSheet(title: "Settings") {
            ScrollViewReader { proxy in
                VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                    SettingsNameSection(
                        model: model.membersModel,
                        userId: model.signedInUserId,
                        roomId: model.signedInRoomId,
                        onSaved: { [weak model] name in model?.updateDisplayName(name) }
                    )
                    SettingsChatAlertsSection(model: model.chatPrefsModel, roomId: model.signedInRoomId)
                        .id("chat-notification-prefs")
                    SettingsPushSection(
                        model: model.pushModel,
                        role: model.signedInRole,
                        registerOnAppear: model.settingsFocus == "push-registration"
                    )
                        .id("push-registration")
                    SettingsStravaSection(model: model.stravaModel)
                        .id("strava")
                    VStack(alignment: .leading, spacing: 4) {
                        CrewSectionHeader(title: "Account")
                        CrewListRow(systemImage: "rectangle.portrait.and.arrow.right", title: "Sign out", tint: theme.danger) {
                            dismiss()
                            model.profileModel.signOut()
                        }
                        .accessibilityLabel("Sign out")
                    }
                    .crewCard()
                }
                .onAppear {
                    if let focus = model.settingsFocus {
                        proxy.scrollTo(focus, anchor: .top)
                    }
                }
            }
        }
    }
}

/// The name your crew sees. It is stored on your membership in the current race.
struct SettingsNameSection: View {
    @Bindable var model: RoomMembersModel
    var userId: String?
    var roomId: String?
    var onSaved: (String) -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CrewSectionHeader(title: "Profile")
            if hasRoom {
                TextField("Display name", text: $model.nameDraft)
                    .textFieldStyle(.crew)
                    .textContentType(.name)
                    .accessibilityLabel("Display name")
                Button("Save name") {
                    Task {
                        if let saved = await model.saveDisplayName() {
                            onSaved(saved)
                        }
                    }
                }
                .buttonStyle(.crewPrimary)
                .disabled(model.working)
            } else {
                Text("Join or create a race to set the name your crew sees.")
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
            }
        }
        .crewCard()
        .task(id: "\(userId ?? "")|\(roomId ?? "")") {
            await model.activate(userId: userId, roomId: roomId)
        }
    }

    private var hasRoom: Bool {
        (roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty == false
    }
}

struct SettingsChatAlertsSection: View {
    var model: ChatNotificationPrefsModel
    var roomId: String?
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CrewSectionHeader(title: "Chat alerts")
            Text("Choose what reaches you from this room.")
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
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
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
            }
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.chat-notification-prefs")
        .accessibilityLabel("Chat alerts")
        .task(id: roomId ?? "") {
            await model.activate(roomId: roomId)
        }
    }
}

struct SettingsPushSection: View {
    var model: PushRegistrationModel
    var role: String?
    var registerOnAppear: Bool
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CrewSectionHeader(title: "This device")
            Text("Register so race alerts can reach you.")
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
            if model.message.isEmpty == false {
                Text(verbatim: model.message)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
            }
            Button("Register this device") {
                Task { await model.register() }
            }
            .buttonStyle(.crewPrimary)
            .disabled(model.isWorking)
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.push-registration")
        .accessibilityLabel("Push")
        .task(id: role ?? "") {
            await model.activate(role: role, registerNow: registerOnAppear)
        }
    }
}

struct SettingsStravaSection: View {
    @Bindable var model: StravaModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CrewSectionHeader(title: "Strava")
            Text("Recent efforts improve the pace estimate.")
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
            if model.message.isEmpty == false {
                Text(verbatim: model.message)
                    .font(CrewFont.body)
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
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.strava")
        .accessibilityLabel("Strava")
        .task {
            await model.activate()
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
                    .buttonStyle(.crewPrimary)
            } else {
                Button(title, action: action)
                    .buttonStyle(.crewSecondary)
            }
        }
        .disabled(isWorking)
    }
}
