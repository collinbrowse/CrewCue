import SwiftUI
import CrewCueClientCore

struct AppRouter: View {
    @Bindable var model: ShellModel

    var body: some View {
        NavigationStack(path: $model.path) {
            RouteScreen(model: model)
                .navigationDestination(for: Route.self) { route in
                    FixtureRouteView(route: route, screen: model.screen)
                }
        }
        .onOpenURL { url in
            model.open(url)
        }
    }
}

struct RouteScreen: View {
    @Bindable var model: ShellModel

    var body: some View {
        Group {
            if model.fixtureOverlay {
                FixtureRouteView(route: model.route, screen: model.screen)
            } else {
                ProductRouteView(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white)
    }
}
