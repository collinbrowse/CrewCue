import SwiftUI
import CrewCueClientCore

struct ProductShellView: View {
    @Bindable var model: ShellModel

    var body: some View {
        TabView(selection: $model.selectedTab) {
            ForEach(ShellTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab) {
                    ProductTabPage(tab: tab, model: model, onSettings: { model.openSettings() })
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
        }
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityIdentifier("crewcue.app-shell")
        .accessibilityLabel("CrewCue")
        .sheet(isPresented: $model.showsSettings, onDismiss: { model.settingsFocus = nil }) {
            ShellSettingsSheet(model: model)
        }
        .onAppear { model.enterShellIfNeeded() }
        .task(id: raceDayID) {
            await model.mapModel.activate(userId: model.signedInUserId, roomId: model.signedInRoomId, role: model.signedInRole)
            model.mapModel.beginLocation()
        }
    }

    /// Course, schedule, and location feed the readouts on every tab, so they load with the shell.
    private var raceDayID: String {
        "\(model.signedInUserId ?? "")|\(model.signedInRoomId ?? "")|\(model.signedInRole ?? "")"
    }
}

struct ProductTabPage: View {
    let tab: ShellTab
    var model: ShellModel
    var onSettings: () -> Void

    var body: some View {
        switch tab {
        case .map:
            MapView(
                model: model.mapModel,
                focus: ShellTab.isMapFeature(model.route.featureId) ? model.route.featureId : "map-track",
                onSettings: onSettings
            )
        case .pace:
            ShellPage(onSettings: onSettings) {
                PaceView(
                    model: model.paceModel,
                    userId: model.signedInUserId,
                    roomId: model.signedInRoomId,
                    role: model.signedInRole,
                    focus: model.route.featureId,
                    progressMeters: model.mapModel.progressMeters
                )
            }
        case .chat:
            ShellPage(onSettings: onSettings) {
                ChatTabPage(model: model)
            }
        case .profile:
            ShellPage(onSettings: onSettings) {
                ProfileTabPage(model: model)
            }
        }
    }
}

/// Non-map tab chrome: tinted page ground with the floating glass top bar, matching the map tab.
struct ShellPage<Content: View>: View {
    var onSettings: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(CrewBackground())
            .safeAreaInset(edge: .top, spacing: 0) {
                CrewTopBar(onSettings: onSettings)
                    .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
                    .padding(.horizontal, 8)
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
