import SwiftUI
import CrewCueClientCore

struct ProfileTabPage: View {
    var model: ShellModel

    var body: some View {
        page
            // Room members and Incidents come in from the right over Profile and go back the
            // same way, with their back control at the top: never a dead end.
            .animation(.snappy(duration: 0.3), value: pageKey)
    }

    /// Which page shows: Profile, or one of the pages it opens. Invite is a sheet over Room members.
    private var pageKey: String {
        switch model.route.featureId {
        case "room-members", "invite-share": "room-members"
        case "readouts-incidents": "readouts-incidents"
        default: "profile"
        }
    }

    @ViewBuilder
    private var page: some View {
        switch model.route.featureId {
        case "room-members", "invite-share":
            RoomMembersView(
                model: model.membersModel,
                userId: model.signedInUserId,
                roomId: model.signedInRoomId,
                role: model.signedInRole,
                upgradeModel: model.upgradeModel,
                onProfile: { model.show(Route(featureId: "profile", state: .success)) },
                onInvite: { model.show(Route(featureId: "invite-share", state: .success)) }
            )
            .transition(.move(edge: .trailing))
            // Invite crew: one dismissible sheet over Room members, closed with its X or a swipe.
            .sheet(isPresented: inviteShown) {
                NavigationStack {
                    InviteShareView(model: model.inviteModel, roomId: model.signedInRoomId)
                        .barClose(identifier: "crewcue.invite-share.close") {
                            model.show(Route(featureId: "room-members", state: .success))
                        }
                }
                .presentationDetents([.medium, .large])
            }
        case "readouts-incidents":
            IncidentsView(
                model: model.incidentsModel,
                roomId: model.signedInRoomId,
                onProfile: { model.show(Route(featureId: "profile", state: .success)) }
            )
            .transition(.move(edge: .trailing))
        default:
            ProfileView(
                model: model.profileModel,
                userId: model.signedInUserId,
                roomId: model.signedInRoomId,
                displayName: model.signedInDisplayName,
                role: model.signedInRole,
                readout: model.mapModel.readout,
                races: model.roster.races,
                racesMessage: model.racesMessage,
                racesLoading: model.racesLoading,
                onSelectRace: { roomId in model.selectRace(roomId) },
                onMembers: { model.show(Route(featureId: "room-members", state: .success)) },
                onIncidents: { model.show(Route(featureId: "readouts-incidents", state: .success)) },
                onJoin: { model.openJoin() },
                onRacePass: { model.showBilling() },
                onFinishSetup: model.canResumeRaceSetup ? { model.resumeRaceSetup() } : nil,
                onCreated: { roomId in
                    model.noteCreated(roomId: roomId)
                },
                onDeleted: { roomId in
                    model.noteDeleted(roomId: roomId)
                },
                onName: { [weak model] name in
                    model?.updateDisplayName(name)
                },
                opensRename: model.route.featureId == "race-rename",
                onRenamed: { [weak model] roomId, name in
                    model?.noteRenamed(roomId: roomId, name: name)
                }
            )
        }
    }
}

extension ProfileTabPage {
    /// The Invite crew sheet is up while the route is `invite-share`; dismissing it (the X or a
    /// swipe down) returns to Room members.
    var inviteShown: Binding<Bool> {
        Binding(
            get: { model.route.featureId == "invite-share" },
            set: { shown in
                if !shown, model.route.featureId == "invite-share" {
                    model.show(Route(featureId: "room-members", state: .success))
                }
            }
        )
    }
}

struct ProfileView: View {
    @Bindable var model: ProfileModel
    var userId: String?
    var roomId: String?
    var displayName: String?
    var role: String?
    var readout: RaceDayReadout
    var races: [RaceSummary]
    var racesMessage: String
    var racesLoading = false
    var onSelectRace: (String) -> Void
    var onMembers: () -> Void
    var onIncidents: () -> Void
    var onJoin: () -> Void
    var onRacePass: () -> Void = {}
    /// The active race's setup isn't finished (its Race Pass page was closed to here): back into it.
    var onFinishSetup: (() -> Void)?
    var onCreated: @MainActor (String) -> Void
    var onDeleted: @MainActor (String) -> Void = { _ in }
    var onName: @MainActor (String) -> Void
    /// `crewcue://dev/race-rename`: open the rename alert once the room has loaded.
    var opensRename = false
    var onRenamed: @MainActor (String, String) -> Void = { _, _ in }
    @Environment(\.crew) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // Each row pads itself, so the rows below a camera column (iPhone Duo's outer display)
        // can run to the display's edge.
        OcclusionScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                ProfileHero(
                    name: model.showsName ? model.displayName : "Profile",
                    role: role,
                    live: readout.pingState == .live
                )
                .padding(.horizontal, CrewSpace.gutter)
                .fullWidthClearOfOcclusions()
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                        .padding(.horizontal, CrewSpace.gutter)
                        .fullWidthClearOfOcclusions()
                }
                if hasRoom {
                    HStack(spacing: CrewSpace.stackSm) {
                        ProfileStatCard(label: "Current pace", value: readout.averagePaceLabel, caption: "Min / mile", accent: true)
                        ProfileStatCard(label: "Time elapsed", value: readout.elapsedLabel, caption: "HH:MM:SS", accent: false)
                    }
                    .padding(.horizontal, CrewSpace.gutter)
                    .fullWidthClearOfOcclusions()
                    VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                        HStack {
                            Text(verbatim: readout.progressLabel)
                                .font(CrewFont.label)
                                .tracking(0.8)
                                .foregroundStyle(theme.body)
                            Spacer()
                            Text(verbatim: readout.percentLabel)
                                .font(CrewFont.metric)
                                .foregroundStyle(theme.primary)
                        }
                        CrewProgressBar(fraction: readout.progressFraction)
                    }
                    .crewGlassCard()
                    .padding(.horizontal, CrewSpace.gutter)
                    .fullWidthClearOfOcclusions()
                    VStack(alignment: .leading, spacing: 4) {
                        CrewSectionHeader(title: "Race & crew")
                        CrewListRow(systemImage: "person.3", title: "Room members", detail: "Your crew for this race", action: onMembers)
                        CrewListRow(systemImage: "exclamationmark.bubble", title: "Incidents", detail: "Log and review race incidents", action: onIncidents)
                        if canRename {
                            CrewListRow(
                                systemImage: "pencil",
                                title: RaceRenameCopy.rowTitle,
                                detail: RaceRenameCopy.rowDetail,
                                action: { model.beginRename(currentName: activeRaceName) }
                            )
                            .accessibilityIdentifier("crewcue.race-rename")
                        }
                        if let onFinishSetup {
                            CrewListRow(systemImage: "flag.checkered", title: OnboardingCopy.finishSetupTitle, detail: OnboardingCopy.finishSetupDetail, action: onFinishSetup)
                                .accessibilityIdentifier("crewcue.profile.finish-setup")
                        }
                        if role == "athlete" {
                            CrewListRow(systemImage: "ticket", title: OnboardingCopy.racePassTitle, detail: "Unlock this race for your crew", action: onRacePass)
                        }
                        if let activeRace, activeRace.isOwned(by: userId) {
                            CrewListRow(
                                systemImage: "trash",
                                title: RaceDeletion.rowTitle,
                                detail: RaceDeletion.rowDetail,
                                tint: theme.danger
                            ) {
                                model.confirmDelete(activeRace)
                            }
                            .disabled(model.deletingRaceId != nil)
                            .accessibilityIdentifier("crewcue.race-delete")
                            .accessibilityLabel(RaceDeletion.rowTitle)
                        }
                    }
                    .crewGlassCard()
                    .padding(.horizontal, CrewSpace.gutter)
                    .fullWidthClearOfOcclusions()
                }
                VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                    CrewSectionHeader(title: "Your races")
                    if races.isEmpty && racesLoading {
                        CairnLoader(onLight: scheme == .light)
                            .frame(width: 56, height: 56)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, CrewSpace.base)
                            .accessibilityIdentifier("crewcue.races-loading")
                    }
                    if races.isEmpty == false {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(races, id: \.id) { race in
                                ProfileRaceRow(
                                    race: race,
                                    active: race.id == roomId,
                                    canDelete: race.isOwned(by: userId),
                                    deleting: model.deletingRaceId == race.id,
                                    onDelete: { model.confirmDelete(race) }
                                ) {
                                    onSelectRace(race.id)
                                }
                            }
                        }
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("crewcue.race-switcher")
                    }
                    if model.deleteMessage.isEmpty == false {
                        Text(verbatim: model.deleteMessage)
                            .font(CrewFont.body)
                            .foregroundStyle(theme.body)
                            .accessibilityIdentifier("crewcue.race-delete.message")
                    }
                    if racesMessage.isEmpty == false {
                        Text(verbatim: racesMessage)
                            .font(CrewFont.body)
                            .foregroundStyle(theme.body)
                    }
                    HStack(spacing: CrewSpace.base) {
                        TextField("New race name", text: $model.raceName)
                            .textFieldStyle(.crewCompact)
                            .submitLabel(.done)
                            .accessibilityLabel("Race name")
                        Button("Create") {
                            Task { await model.createRace(onCreated: onCreated) }
                        }
                        .buttonStyle(.crewPillProminent)
                        .crewBusy(model.creatingRace)
                        .accessibilityLabel("Create new race")
                    }
                    HStack(spacing: CrewSpace.base) {
                        Text("Have an invite code?")
                            .font(CrewFont.hint)
                            .foregroundStyle(theme.outline)
                        Spacer(minLength: 0)
                        Button("Join race room", action: onJoin)
                            .buttonStyle(.crewPill)
                    }
                }
                .crewGlassCard()
                .padding(.horizontal, CrewSpace.gutter)
                .fullWidthClearOfOcclusions()
            }
            .padding(.top, CrewSpace.gutter)
            .padding(.bottom, CrewSpace.stackLg)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("crewcue.profile")
        .accessibilityLabel("Profile")
        .alert(
            RaceDeletion.confirmTitle(raceName: model.pendingDelete?.name ?? ""),
            isPresented: deleteConfirmShown,
            presenting: model.pendingDelete
        ) { race in
            Button(RaceDeletion.confirmButton, role: .destructive) {
                Task { await model.delete(race, onDeleted: onDeleted) }
            }
            .accessibilityIdentifier("crewcue.race-delete.confirm")
            Button(RaceDeletion.cancelButton, role: .cancel) {
                model.pendingDelete = nil
            }
        } message: { race in
            Text(RaceDeletion.confirmBody(paid: race.paid ?? false))
        }
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId, displayName: displayName, onName: onName)
            if opensRename, canRename {
                model.beginRename(currentName: activeRaceName)
            }
        }
        .alert(RaceRenameCopy.rowTitle, isPresented: $model.showsRename) {
            TextField("Race name", text: $model.renameDraft)
                .accessibilityLabel("Race name")
            Button("Save") {
                Task { await model.renameRace(onRenamed: onRenamed) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(RaceRenameCopy.hint)
        }
    }

    private var canRename: Bool {
        hasRoom && PlanAuthority.mayEditRaceSetup(role: role ?? "")
    }

    private var activeRaceName: String {
        races.first { $0.id == roomId }?.name ?? ""
    }

    private var activeRace: RaceSummary? {
        races.first { $0.id == roomId }
    }

    /// Dismissing the dialog (Cancel, or a tap outside) forgets the race. The delete button clears
    /// it itself before the request starts.
    private var deleteConfirmShown: Binding<Bool> {
        Binding(
            get: { model.pendingDelete != nil },
            set: { shown in
                if shown == false { model.pendingDelete = nil }
            }
        )
    }

    private var hasRoom: Bool {
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty == false
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")|\(displayName ?? "")"
    }
}

/// One loaded race. Tapping it makes it the race Map, Pace, Chat, and Profile follow.
/// The owner's races also get a Delete race context menu entry; crew rows do not.
struct ProfileRaceRow: View {
    let race: RaceSummary
    let active: Bool
    var canDelete = false
    var deleting = false
    var onDelete: () -> Void = {}
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        // Delete race in Race & crew is the one visible delete; it removes the race for everyone.
        // A long press on a row the runner owns offers the same delete without switching races.
        selectButton
            .disabled(deleting)
    }

    private var selectButton: some View {
        Button(action: action) {
            HStack(spacing: CrewSpace.stackSm) {
                Image(systemName: active ? "flag.checkered" : "flag")
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(theme.primary)
                    .frame(width: 28, height: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: race.name)
                        .font(CrewFont.rowTitle)
                        .foregroundStyle(active ? theme.primary : theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(verbatim: race.roleLabel)
                        .font(CrewFont.hint)
                        .foregroundStyle(theme.outline)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                if active {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(theme.primary)
                }
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: race.name))
        .accessibilityValue(active ? Text("Active race") : Text(""))
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("crewcue.race-switcher.\(race.id)")
        .contextMenu {
            if canDelete {
                Button(RaceDeletion.rowTitle, systemImage: "trash", role: .destructive, action: onDelete)
            }
        }
    }
}

/// Runner hero: slate ground, course-profile art, name, role, and live chip.
struct ProfileHero: View {
    let name: String
    let role: String?
    let live: Bool
    @Environment(\.crew) private var theme

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: CrewPalette.heroGradient,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            CourseProfileArt(ground: false)
                .padding(.top, 28)
                .padding(.bottom, 64)
                .accessibilityHidden(true)
            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: name)
                        .font(CrewFont.display)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                    if let role, role.isEmpty == false {
                        Label(RaceRole.label(role), systemImage: "person.badge.shield.checkmark")
                            .font(CrewFont.label)
                            .foregroundStyle(CrewPalette.heroAccent)
                    }
                }
                Spacer(minLength: 8)
                if live {
                    StatusChip(text: "LIVE TRACKING", style: .secondary, dot: true)
                }
            }
            .padding(CrewSpace.margin)
        }
        .frame(height: 180)
        .clipShape(RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
        .shadow(color: theme.shadow, radius: 16, y: 6)
        .accessibilityElement(children: .combine)
    }
}

struct ProfileStatCard: View {
    let label: String
    let value: String
    let caption: String
    let accent: Bool
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            Text(label)
                .font(CrewFont.label)
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(theme.body)
            Text(verbatim: value)
                .font(CrewFont.metric)
                .foregroundStyle(accent ? theme.primary : theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
            Text(caption)
                .font(CrewFont.kicker)
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(theme.body)
        }
        .frame(alignment: .topLeading)
        .crewGlassCard(padding: CrewSpace.gutter)
        .accessibilityElement(children: .combine)
    }
}
