import SwiftUI
import CrewCueClientCore

struct AppRouter: View {
    @Bindable var model: ShellModel

    var body: some View {
        // Each screen in the stack reads the window's occlusion regions (the cameras' column on
        // iPhone Duo's outer display) for its rows that run past them.
        NavigationStack(path: $model.path) {
            RouteScreen(model: model)
                .readsOcclusionDisplay()
                .navigationDestination(for: Route.self) { route in
                    FixtureRouteView(route: route, screen: model.screen)
                        .readsOcclusionDisplay()
                }
        }
        .onOpenURL { url in
            model.open(url)
        }
        // A Universal Link (the join page, `applinks:collinbrowse.github.io`) arrives as a
        // browsing activity. `open` accepts only join links from it; the AASA file limits the
        // site's paths to `/crewcue/join/*`.
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL {
                model.open(url)
            }
        }
        .crewTheme()
    }
}

struct RouteScreen: View {
    @Bindable var model: ShellModel

    var body: some View {
        Group {
            if model.fixtureOverlay {
                FixtureRouteView(route: model.route, screen: model.screen, shell: model)
            } else {
                ProductRouteView(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
