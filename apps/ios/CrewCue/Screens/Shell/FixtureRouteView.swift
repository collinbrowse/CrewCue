import SwiftUI
import CrewCueClientCore

struct FixtureRouteView: View {
    let route: Route
    let screen: FeatureScreen

    var body: some View {
        switch route.featureId {
        case "map-track", "map-checkpoint-pick", "map-navigate":
            MapLibrePocket(screen: screen)
        case "chat-thread", "chat-notification-prefs":
            StreamPocket(screen: screen)
        case "app-shell":
            FixtureShellView()
        default:
            FeatureScreenView(screen: screen)
        }
    }
}

struct FixtureShellView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FixtureShellCaption()
            TabView {
                ForEach(ShellTab.allCases) { tab in
                    FixtureTabPage(featureId: tab.featureId)
                        .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                        .accessibilityIdentifier(tab.accessibilityIdentifier)
                }
            }
        }
        .accessibilityIdentifier("crewcue.app-shell")
        .accessibilityLabel("CrewCue")
    }
}

struct FixtureShellCaption: View {
    var body: some View {
        Text("crewcue.app-shell")
            .font(.caption)
            .foregroundStyle(Color.black)
            .padding(.horizontal)
            .padding(.top, 8)
    }
}

struct FixtureTabPage: View {
    let featureId: String

    var body: some View {
        FeatureScreenView(screen: CrewCueClientCore.featureScreen(id: featureId, state: .success))
    }
}

struct ProductRouteView: View {
    @Bindable var model: ShellModel

    var body: some View {
        switch model.route.featureId {
        case "join-crew":
            JoinCrewView(model: model.joinModel)
        case "athlete-setup":
            AthleteSetupView(model: model.athleteModel)
        case "onboarding-notifications":
            NotificationPermissionScreen()
        case "auth-sign-in":
            AuthOrShell(model: model)
        case "app-shell", "map-track", "chat-thread", "chat-notification-prefs", "push-registration", "profile", "strava", "room-members", "readouts-incidents":
            ShellOrSignedOut(model: model)
        default:
            if ShellTab.isPaceFeature(model.route.featureId) || ShellTab.isMapFeature(model.route.featureId) {
                ShellOrSignedOut(model: model)
            } else {
                FixtureRouteView(route: model.route, screen: model.screen)
            }
        }
    }
}

struct AuthOrShell: View {
    @Bindable var model: ShellModel

    var body: some View {
        if model.isSignedIn {
            ProductShellView(model: model)
        } else {
            AuthSignInView(model: model.authModel)
        }
    }
}

struct ShellOrSignedOut: View {
    @Bindable var model: ShellModel

    var body: some View {
        if model.isSignedIn {
            ProductShellView(model: model)
        } else if model.route.featureId == "app-shell" {
            AuthSignInView(model: model.authModel)
        } else {
            FixtureRouteView(route: model.route, screen: model.screen)
        }
    }
}
