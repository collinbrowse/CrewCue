import SwiftUI
import CrewCueClientCore

/// Every app setting, reached from the top-bar gear on any tab. Settings deeplinks open this sheet at their section.
struct ShellSettingsSheet: View {
    var model: ShellModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crew) private var theme

    var body: some View {
        ToolSheet(title: "Settings") {
            ScrollViewReader { proxy in
                VStack(alignment: .leading, spacing: CrewSpace.margin) {
                    CrewSettingsGroup(title: "Profile") {
                        SettingsNameSection(
                            model: model.membersModel,
                            userId: model.signedInUserId,
                            roomId: model.signedInRoomId,
                            onSaved: { [weak model] name in model?.updateDisplayName(name) }
                        )
                    }
                    CrewSettingsGroup(title: "Notifications") {
                        SettingsPushSection(
                            model: model.pushModel,
                            role: model.signedInRole,
                            registerOnAppear: model.settingsFocus == "push-registration"
                        )
                        SettingsChatAlertsSection(model: model.chatPrefsModel, roomId: model.signedInRoomId)
                            .id("chat-notification-prefs")
                    }
                    .id("push-registration")
                    if model.mapModel.isAthlete {
                        CrewSettingsGroup(title: "Race day") {
                            SettingsTrackingSection(mapModel: model.mapModel, userId: model.signedInUserId)
                        }
                        .id("location-heartbeat")
                    }
                    CrewSettingsGroup(title: "Pace estimate") {
                        SettingsActivityImportSection(model: model.activityImportModel, userId: model.signedInUserId)
                        if ClientFeatureFlags.stravaEnabled {
                            SettingsStravaSection(model: model.stravaModel)
                                .id("strava")
                        }
                    }
                    .id("activity-import")
                    CrewSettingsGroup(title: "Account") {
                        Button {
                            dismiss()
                            model.profileModel.signOut()
                        } label: {
                            CrewSettingRow(
                                systemImage: "rectangle.portrait.and.arrow.right",
                                title: "Sign out",
                                hint: "Your races and runs stay saved to your account.",
                                tint: theme.danger
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Sign out")
                        SettingsDeleteAccountRow(model: model.accountDeletionModel) {
                            dismiss()
                            model.profileModel.signOut()
                        }
                    }
                    .id("account-deletion")
                    Text("Pacing model built with race results from [OpenSplitTime.org](https://www.opensplittime.org).")
                        .font(CrewFont.hint)
                        .foregroundStyle(theme.outline)
                        .tint(theme.outline)
                        .padding(.horizontal, CrewSpace.base)
                        .accessibilityIdentifier("crewcue.settings.credits")
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

    var body: some View {
        Group {
            if hasRoom {
                CrewSettingRow(
                    systemImage: "person",
                    title: "Name your crew sees",
                    hint: "Shown on your chat messages and in this race's crew list.",
                    trailing: { EmptyView() },
                    below: {
                        HStack(spacing: CrewSpace.base) {
                            TextField("Display name", text: $model.nameDraft)
                                .textFieldStyle(.crewCompact)
                                .textContentType(.name)
                                .accessibilityLabel("Display name")
                            Button("Save") {
                                Task {
                                    if let saved = await model.saveDisplayName() {
                                        onSaved(saved)
                                    }
                                }
                            }
                            .buttonStyle(.crewPillProminent)
                            .disabled(model.working)
                            .accessibilityLabel("Save name")
                        }
                    }
                )
            } else {
                CrewSettingRow(
                    systemImage: "person",
                    title: "Name your crew sees",
                    hint: "Join or create a race to set it."
                )
            }
        }
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

    var body: some View {
        CrewSettingRow(
            systemImage: "bubble.left.and.bubble.right",
            title: "Crew chat",
            hint: model.message.isEmpty ? ChatAlertCopy.hint(for: model.preference) : model.message,
            trailing: { EmptyView() },
            below: {
                Picker("Crew chat alerts", selection: Binding(
                    get: { model.preference },
                    set: { value in Task { await model.choose(value) } }
                )) {
                    Text("All").tag("all")
                    Text("Mentions").tag("mentions")
                    Text("Off").tag("none")
                }
                .pickerStyle(.segmented)
                .disabled(model.isWorking)
            }
        )
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
        CrewSettingRow(
            systemImage: "bell",
            title: "Race alerts on this phone",
            hint: hint,
            trailing: {
                if model.enabled, model.message.isEmpty {
                    Label("On", systemImage: "checkmark")
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.primary)
                } else {
                    Button("Turn on") {
                        Task { await model.register() }
                    }
                    .buttonStyle(.crewPillProminent)
                    .crewBusy(model.isWorking)
                    .accessibilityLabel("Register this device")
                }
            }
        )
        .accessibilityIdentifier("crewcue.push-registration")
        .accessibilityLabel("Push")
        .task(id: role ?? "") {
            await model.activate(role: role, registerNow: registerOnAppear)
        }
    }

    private var hint: String {
        if model.message.isEmpty == false { return model.message }
        return model.enabled
            ? "On. Check-ins, ETA changes and crew chat reach you, even with the app closed."
            : "Check-ins, ETA changes and crew chat, even with the app closed."
    }
}

/// How often the runner's phone shares a position on race day. Saved on this device.
struct SettingsTrackingSection: View {
    var mapModel: MapModel
    var userId: String?
    @State private var interval = TrackingSettings.defaultIntervalSeconds

    var body: some View {
        CrewSettingRow(
            systemImage: "location",
            title: "Share my location every",
            hint: "Your crew's mile and ETA come from these. Shorter uses more battery.",
            trailing: {
                Picker("Location interval", selection: $interval) {
                    ForEach(TrackingSettings.allowedIntervalSeconds, id: \.self) { seconds in
                        Text(verbatim: MapModel.intervalText(seconds)).tag(seconds)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .accessibilityIdentifier("crewcue.location-interval")
            }
        )
        .accessibilityLabel("Location interval")
        .onAppear {
            interval = mapModel.trackingIntervalSeconds
            if let userId, let directory = try? AppDirectories.userDirectory(userId: userId) {
                interval = TrackingSettings.load(userDirectory: directory).intervalSeconds
            }
        }
        .onChange(of: interval) { _, seconds in
            guard let userId, let directory = try? AppDirectories.userDirectory(userId: userId) else { return }
            try? TrackingSettings(intervalSeconds: seconds).save(userDirectory: directory)
            mapModel.reloadTrackingInterval()
        }
    }
}

struct SettingsStravaSection: View {
    @Bindable var model: StravaModel

    var body: some View {
        CrewSettingRow(
            systemImage: "figure.run",
            title: "Strava",
            hint: hint,
            trailing: {
                if model.connected {
                    Button("Disconnect") {
                        Task { await model.disconnect() }
                    }
                    .buttonStyle(.crewPill)
                    .crewBusy(model.busy)
                } else {
                    Button("Connect") {
                        Task { await model.connect() }
                    }
                    .buttonStyle(.crewPillProminent)
                    .crewBusy(model.busy)
                }
            }
        )
        .accessibilityIdentifier("crewcue.strava")
        .accessibilityLabel("Strava")
        .task {
            await model.activate()
        }
    }

    private var hint: String {
        if model.connected {
            return "Connected. Your recent Strava runs sharpen the pace estimate."
        }
        if model.message.isEmpty || model.message == "Strava is not connected." {
            return "Not connected. Your recent Strava runs sharpen the pace estimate."
        }
        return model.message
    }
}

/// Delete account row and its confirm step (#560, App Store 5.1.1(v)).
struct SettingsDeleteAccountRow: View {
    @Bindable var model: AccountDeletionModel
    var onDeleted: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        Button {
            model.confirming = true
        } label: {
            CrewSettingRow(
                systemImage: "trash",
                title: AccountDeletion.rowTitle,
                hint: model.message.isEmpty ? AccountDeletion.rowHint : model.message,
                tint: theme.danger
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.deleting)
        .accessibilityIdentifier("crewcue.account-deletion")
        .accessibilityLabel(AccountDeletion.rowTitle)
        .alert(AccountDeletion.confirmTitle, isPresented: $model.confirming) {
            Button(AccountDeletion.confirmButton, role: .destructive) {
                Task {
                    if await model.delete() {
                        onDeleted()
                    }
                }
            }
            Button(AccountDeletion.cancelButton, role: .cancel) {}
        } message: {
            Text(AccountDeletion.confirmBody)
        }
    }
}
