import SwiftUI

struct ProductShellView: View {
    @Bindable var model: ShellModel
    @Environment(\.kinetic) private var theme

    var body: some View {
        TabView(selection: $model.selectedTab) {
            ForEach(ShellTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab) {
                    ProductTabPage(tab: tab, model: model)
                        .accessibilityIdentifier(tab.accessibilityIdentifier)
                }
            }
        }
        .accessibilityIdentifier("crewcue.app-shell")
        .accessibilityLabel("CrewCue")
        .toolbarBackground(theme.card, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .onAppear { model.enterShellIfNeeded() }
    }
}

struct ProductTabPage: View {
    let tab: ShellTab
    var model: ShellModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch tab {
            case .map:
                MapView(
                    model: model.mapModel,
                    userId: model.signedInUserId,
                    roomId: model.signedInRoomId,
                    role: model.signedInRole
                )
            case .pace:
                PaceView(
                    model: model.paceModel,
                    userId: model.signedInUserId,
                    roomId: model.signedInRoomId,
                    role: model.signedInRole
                )
            case .chat:
                ChatTabPage(model: model)
            case .profile:
                ProfileTabPage(model: model)
            }
        }
    }
}
