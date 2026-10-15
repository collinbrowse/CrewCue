import SwiftUI
import CrewCueClientCore

struct ProfileTabPage: View {
    var model: ShellModel

    var body: some View {
        switch model.route.featureId {
        case "room-members":
            RoomMembersView(
                model: model.membersModel,
                userId: model.signedInUserId,
                roomId: model.signedInRoomId,
                onProfile: { model.show(Route(featureId: "profile", state: .success)) }
            )
        case "readouts-incidents":
            IncidentsView(
                model: model.incidentsModel,
                roomId: model.signedInRoomId,
                onProfile: { model.show(Route(featureId: "profile", state: .success)) }
            )
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
                onSelectRace: { roomId in model.selectRace(roomId) },
                onMembers: { model.show(Route(featureId: "room-members", state: .success)) },
                onIncidents: { model.show(Route(featureId: "readouts-incidents", state: .success)) },
                onJoin: { model.show(Route(featureId: "join-crew", state: .success)) },
                onCreated: { roomId in
                    model.noteJoined(roomId: roomId, role: "athlete")
                },
                onName: { [weak model] name in
                    model?.updateDisplayName(name)
                }
            )
        }
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
    var onSelectRace: (String) -> Void
    var onMembers: () -> Void
    var onIncidents: () -> Void
    var onJoin: () -> Void
    var onCreated: @MainActor (String) -> Void
    var onName: @MainActor (String) -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                ProfileHero(
                    name: model.showsName ? model.displayName : "Profile",
                    role: role,
                    live: readout.lastPingLabel != nil
                )
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                }
                if hasRoom {
                    HStack(spacing: CrewSpace.stackSm) {
                        ProfileStatCard(label: "Current pace", value: readout.averagePaceLabel, caption: "Min / mile", accent: true)
                        ProfileStatCard(label: "Time elapsed", value: readout.elapsedLabel, caption: "HH:MM:SS", accent: false)
                    }
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
                    VStack(alignment: .leading, spacing: 4) {
                        CrewSectionHeader(title: "Race & crew")
                        CrewListRow(systemImage: "person.3", title: "Room members", detail: "Your crew for this race", action: onMembers)
                        CrewListRow(systemImage: "exclamationmark.bubble", title: "Incidents", detail: "Log and review race incidents", action: onIncidents)
                    }
                    .crewGlassCard()
                }
                VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                    CrewSectionHeader(title: "Your races")
                    if races.isEmpty == false {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(races, id: \.id) { race in
                                ProfileRaceRow(race: race, active: race.id == roomId) {
                                    onSelectRace(race.id)
                                }
                            }
                        }
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("crewcue.race-switcher")
                    }
                    if racesMessage.isEmpty == false {
                        Text(verbatim: racesMessage)
                            .font(CrewFont.body)
                            .foregroundStyle(theme.body)
                    }
                    TextField("Race name", text: $model.raceName)
                        .textFieldStyle(.crew)
                        .accessibilityLabel("Race name")
                    Button("Create new race") {
                        Task { await model.createRace(onCreated: onCreated) }
                    }
                    .buttonStyle(.crewPrimary)
                    .disabled(model.creatingRace)
                    Button("Join race room", action: onJoin)
                        .buttonStyle(.crewSecondary)
                }
                .crewGlassCard()
            }
            .padding(.horizontal, CrewSpace.gutter)
            .padding(.top, CrewSpace.gutter)
            .padding(.bottom, CrewSpace.stackLg)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("crewcue.profile")
        .accessibilityLabel("Profile")
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId, displayName: displayName, onName: onName)
        }
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
struct ProfileRaceRow: View {
    let race: RaceSummary
    let active: Bool
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: CrewSpace.stackSm) {
                IconDisc(systemImage: active ? "flag.checkered" : "flag", tint: active ? theme.primary : nil)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: race.name)
                        .font(CrewFont.button)
                        .foregroundStyle(active ? theme.primary : theme.ink)
                        .lineLimit(1)
                    Text(verbatim: race.roleLabel)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                }
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
    }
}

/// Runner hero: night-trail gradient, illustration, name, role, and live chip.
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
            Image("OnboardingRunner")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(.top, 8)
                .padding(.trailing, -24)
                .opacity(0.9)
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
        .frame(height: 240)
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
            Spacer(minLength: 8)
            Text(verbatim: value)
                .font(CrewFont.metricLarge)
                .foregroundStyle(accent ? theme.primary : theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
            Text(caption)
                .font(CrewFont.kicker)
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(theme.body)
        }
        .frame(minHeight: 120, alignment: .topLeading)
        .crewGlassCard(padding: CrewSpace.gutter + 4)
        .accessibilityElement(children: .combine)
    }
}
