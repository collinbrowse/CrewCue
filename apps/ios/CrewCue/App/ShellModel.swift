import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class ShellModel {
    private let graph: ClientGraph
    var route: Route
    var path: [Route] = []
    var screen: FeatureScreen

    init(graph: ClientGraph, route: Route) {
        self.graph = graph
        self.route = route
        self.screen = graph.featureScreen(for: route)
    }

    func open(_ url: URL) {
        let next = Route.parse(url.absoluteString) ?? Route(featureId: "app-shell", state: .success)
        show(next)
    }

    func show(_ route: Route) {
        self.route = route
        screen = graph.featureScreen(for: route)
        path = []
    }
}
