import SwiftUI
import CrewCueClientCore

struct RootView: View {
    @State private var screen: FeatureScreen?

    init() {
        if let index = CommandLine.arguments.firstIndex(of: "--deeplink"),
           CommandLine.arguments.indices.contains(index + 1),
           let parsed = CrewCueClientCore.featureScreen(forCrewCueURL: CommandLine.arguments[index + 1]) {
            _screen = State(initialValue: parsed)
        } else {
            _screen = State(initialValue: nil)
        }
    }

    var body: some View {
        Group {
            if let screen {
                pocket(for: screen)
            } else {
                AppShellView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white)
        .onOpenURL { url in
            screen = CrewCueClientCore.featureScreen(forCrewCueURL: url.absoluteString)
        }
    }

    @ViewBuilder
    private func pocket(for screen: FeatureScreen) -> some View {
        switch screen.featureId {
        case "map-track", "map-checkpoint-pick", "map-navigate":
            MapLibrePocket(screen: screen)
        case "chat-thread", "chat-notification-prefs":
            StreamPocket(screen: screen)
        case "auth-sign-in", "strava":
            Auth0Pocket(screen: screen)
        case "app-shell":
            AppShellView()
        default:
            FeatureScreenView(screen: screen)
        }
    }
}

struct FeatureScreenView: View {
    let screen: FeatureScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(screen.accessibilityIdentifier)
                .font(.caption)
            Text(screen.title)
                .font(.title2)
            Text(screen.body)
                .font(.body)
        }
        .foregroundStyle(Color.black)
        .padding()
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .accessibilityIdentifier(screen.accessibilityIdentifier)
        .accessibilityLabel(screen.accessibilityIdentifier)
    }
}

struct AppShellView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("crewcue.app-shell")
                .font(.caption)
                .foregroundStyle(Color.black)
                .padding(.horizontal)
                .padding(.top, 8)
            TabView {
                tab("Map", identifier: "crewcue.tab.map", systemImage: "map")
                tab("Pace", identifier: "crewcue.tab.pace", systemImage: "stopwatch")
                tab("Chat", identifier: "crewcue.tab.chat", systemImage: "bubble.left")
                tab("Profile", identifier: "crewcue.tab.profile", systemImage: "person")
            }
        }
        .accessibilityIdentifier("crewcue.app-shell")
        .accessibilityLabel("crewcue.app-shell")
    }

    private func tab(_ title: String, identifier: String, systemImage: String) -> some View {
        FeatureScreenView(screen: CrewCueClientCore.featureScreen(id: tabFeature(title), state: .success))
            .tabItem { Label(title, systemImage: systemImage) }
            .accessibilityIdentifier(identifier)
    }

    private func tabFeature(_ title: String) -> String {
        switch title {
        case "Map": "map-track"
        case "Pace": "schedule-sheet"
        case "Chat": "chat-thread"
        case "Profile": "profile"
        default: "hello"
        }
    }
}
