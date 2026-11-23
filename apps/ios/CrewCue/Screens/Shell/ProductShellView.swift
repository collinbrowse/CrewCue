import SwiftUI
import CrewCueClientCore

struct ProductShellView: View {
    @Bindable var model: ShellModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $model.selectedTab) {
            ForEach(ShellTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab) {
                    ProductTabPage(tab: tab, model: model, onSettings: { model.openSettings() })
                        // Contain the page, so its id doesn't replace the ids of its controls (the race banner).
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier(tab.accessibilityIdentifier)
                        .toolbar(.hidden, for: .tabBar)
                        .safeAreaInset(edge: .bottom, spacing: 0) {
                            Color.clear.frame(height: CrewTabBar.reservedHeight)
                        }
                }
            }
        }
        .overlay(alignment: .bottom) {
            CrewTabBar(selection: $model.selectedTab, chatBadge: model.chatModel.unreadCount)
                // Below a camera column (iPhone Duo's outer display) the bar spans the display.
                .fullWidthClearOfOcclusions()
        }
        .toolbar(.hidden, for: .navigationBar)
        // Contain the children, or the shell's label replaces every tab button's own label.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.app-shell")
        .accessibilityLabel("CrewCue")
        .sheet(isPresented: $model.showsSettings, onDismiss: { model.settingsFocus = nil }) {
            ShellSettingsSheet(model: model)
        }
        .sheet(isPresented: $model.choosingRace) {
            RaceChooserSheet(model: model)
        }
        .onAppear { model.enterShellIfNeeded() }
        .task(id: raceDayID) {
            await model.mapModel.activate(userId: model.signedInUserId, roomId: model.signedInRoomId, role: model.signedInRole)
            await model.mapModel.followRunner()
        }
        .onChange(of: scenePhase) { _, phase in
            // Back from the lock screen or another app: read the runner now, not at the next tick.
            if phase == .active {
                Task { await model.mapModel.refreshNow() }
            }
        }
    }

    /// Course, schedule, and the athlete's latest ping feed the readouts on every tab, so they load with the shell.
    private var raceDayID: String {
        "\(model.signedInUserId ?? "")|\(model.signedInRoomId ?? "")|\(model.signedInRole ?? "")"
    }
}

struct ProductTabPage: View {
    let tab: ShellTab
    var model: ShellModel
    var onSettings: () -> Void

    var body: some View {
        if tab != .profile && model.signedInRoomId == nil {
            ShellPage(onSettings: onSettings) {
                NoRaceView(
                    races: model.roster.races,
                    onSelect: { model.selectRace($0) },
                    onCreate: { model.selectedTab = .profile },
                    onJoin: { model.show(Route(featureId: "join-crew", state: .success)) }
                )
            }
        } else {
            tabContent
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch tab {
        case .map:
            MapView(
                model: model.mapModel,
                focus: ShellTab.isMapFeature(model.route.featureId) ? model.route.featureId : "map-track",
                onSettings: onSettings,
                access: model.raceAccess,
                onUnlock: model.isUnpaidRunnerRace ? { model.showBilling() } : nil
            )
        case .pace:
            ShellPage(onSettings: onSettings, access: model.raceAccess, onUnlock: { model.showBilling() }) {
                PaceView(
                    model: model.paceModel,
                    userId: model.signedInUserId,
                    roomId: model.signedInRoomId,
                    role: model.signedInRole,
                    focus: model.route.featureId,
                    runner: model.mapModel.runner,
                    live: model.mapModel.live
                )
            }
        case .chat:
            ShellPage(onSettings: onSettings, access: model.raceAccess, onUnlock: { model.showBilling() }) {
                ChatTabPage(model: model)
            }
        case .profile:
            ShellPage(onSettings: onSettings) {
                ProfileTabPage(model: model)
            }
        }
    }
}

/// Map, Pace, and Chat need a race. Until there is one, offer the person's other races (after
/// they deleted the active one) and the two ways to get a new one.
struct NoRaceView: View {
    var races: [RaceSummary] = []
    var onSelect: (String) -> Void = { _ in }
    var onCreate: () -> Void
    var onJoin: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            Text(races.isEmpty ? "No race yet" : "Choose a race")
                .font(CrewFont.headline)
                .foregroundStyle(theme.ink)
            RaceChoices(races: races, onSelect: onSelect, onCreate: onCreate, onJoin: onJoin)
        }
        .crewGlassCard()
        .padding(.horizontal, CrewSpace.gutter)
        .padding(.top, CrewSpace.gutter)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.no-race")
    }
}

/// Asked right after the active race was deleted: pick another race, or create or join one.
struct RaceChooserSheet: View {
    var model: ShellModel
    @Environment(\.crew) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                Text("Race deleted")
                    .font(CrewFont.headline)
                    .foregroundStyle(theme.ink)
                    .accessibilityAddTraits(.isHeader)
                RaceChoices(
                    races: model.roster.races,
                    onSelect: { roomId in
                        model.selectRace(roomId)
                        dismiss()
                    },
                    onCreate: {
                        model.selectedTab = .profile
                        dismiss()
                    },
                    onJoin: {
                        dismiss()
                        model.show(Route(featureId: "join-crew", state: .success))
                    }
                )
            }
            .padding(CrewSpace.margin)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("crewcue.race-chooser")
    }
}

/// The person's races to switch to, then Create new race and Join race room.
struct RaceChoices: View {
    var races: [RaceSummary]
    var onSelect: (String) -> Void
    var onCreate: () -> Void
    var onJoin: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            Text(races.isEmpty
                 ? "Create a race for your run, or join your crew's race with an invite code."
                 : "Pick the race Map, Pace and Chat should follow, or start a new one.")
                .font(CrewFont.bodyLarge)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
            if !races.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(races, id: \.id) { race in
                        ProfileRaceRow(race: race, active: false) { onSelect(race.id) }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("crewcue.race-choices")
            }
            Button("Create new race", action: onCreate)
                .buttonStyle(races.isEmpty ? CrewButtonStyle.crewPrimary : CrewButtonStyle.crewSecondary)
            Button("Join race room", action: onJoin)
                .buttonStyle(.crewSecondary)
        }
    }
}

/// Non-map tab chrome: tinted page ground with the floating glass top bar, matching the map tab.
/// `access` adds the race's Unlock race (runner) or locked (crew) banner under the bar.
struct ShellPage<Content: View>: View {
    var onSettings: () -> Void
    var access: RaceAccess? = nil
    var onUnlock: () -> Void = {}
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(CrewBackground())
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: CrewSpace.base) {
                    CrewTopBar(onSettings: onSettings)
                        .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
                        .padding(.horizontal, 8)
                    if let access {
                        RaceAccessBanner(access: access, onUnlock: onUnlock)
                            .padding(.horizontal, CrewSpace.gutter)
                    }
                }
            }
    }
}

/// Floating pill tab bar. The active tab is a filled primary capsule, as in the map mockup.
struct CrewTabBar: View {
    static let reservedHeight: CGFloat = 84

    @Binding var selection: ShellTab
    var chatBadge: Int
    @Environment(\.crew) private var theme
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 4) {
            ForEach(ShellTab.allCases) { tab in
                Button {
                    withAnimation(.snappy(duration: 0.25)) { selection = tab }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.barImage)
                            .font(.system(size: 19, weight: .semibold))
                            .overlay(alignment: .topTrailing) {
                                if tab == .chat && chatBadge > 0 {
                                    Circle()
                                        .fill(theme.danger)
                                        .frame(width: 9, height: 9)
                                        .offset(x: 5, y: -3)
                                }
                            }
                        Text(tab.title)
                            .font(.system(size: 10, weight: .bold))
                            .tracking(1)
                            .textCase(.uppercase)
                    }
                    .foregroundStyle(selection == tab ? theme.onPrimary : theme.body)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background {
                        if selection == tab {
                            Capsule()
                                .fill(theme.primary)
                                .matchedGeometryEffect(id: "pill", in: pill)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
                .accessibilityValue(tab == .chat && chatBadge > 0 ? "\(chatBadge) unread" : "")
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
                // The pill bar keeps a fixed size. At large text sizes a long press shows the tab enlarged, as the system tab bar does.
                .accessibilityShowsLargeContentViewer {
                    Label(tab.title, systemImage: tab.barImage)
                }
            }
        }
        .padding(6)
        .crewGlass(in: Capsule())
        .shadow(color: theme.shadow, radius: 18, y: 8)
        .padding(.horizontal, CrewSpace.gutter)
        .padding(.bottom, 4)
    }
}

private extension ShellTab {
    var barImage: String {
        switch self {
        case .map: "safari"
        case .pace: "stopwatch"
        case .chat: "text.bubble"
        case .profile: "person"
        }
    }
}
