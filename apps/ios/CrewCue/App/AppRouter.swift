import SwiftUI
import CrewCueClientCore

struct AppRouter: View {
    @Bindable var model: ShellModel

    var body: some View {
        NavigationStack(path: $model.path) {
            RouteScreen(route: model.route, screen: model.screen)
                .navigationDestination(for: Route.self) { route in
                    RouteScreen(route: route, screen: model.screen)
                }
        }
        .onOpenURL { url in
            model.open(url)
        }
    }
}

struct RouteScreen: View {
    let route: Route
    let screen: FeatureScreen

    var body: some View {
        pocket
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color.white)
    }

    @ViewBuilder
    private var pocket: some View {
        switch route.featureId {
        case "map-track", "map-checkpoint-pick", "map-navigate":
            MapLibrePocket(screen: screen)
        case "chat-thread", "chat-notification-prefs":
            StreamPocket(screen: screen)
        case "auth-sign-in", "strava":
            Auth0Pocket(screen: screen)
        case "app-shell":
            AppShellView()
        case "brand-loader":
            BrandLoaderView(screen: screen)
        default:
            FeatureScreenView(screen: screen)
        }
    }
}
