import SwiftUI
import CrewCueClientCore

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
        .accessibilityLabel(screen.title)
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
        .accessibilityLabel("CrewCue")
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
